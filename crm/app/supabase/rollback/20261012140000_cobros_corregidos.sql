-- Vuelta atrás de 20261012140000_cobros_corregidos.sql
-- Deja registrar_cobro y registrar_cobro_masivo EXACTAMENTE como estaban en la base el 12/10/2026 (versión de Manu,
-- copiada del resultado de supabase/diagnostico/todas_las_funciones.sql) y saca el disparador y las funciones de ayuda.
-- No borra datos: los cobros y saldos a favor ya grabados quedan como están. La columna movimientos.cobro_origen_id
-- queda (vacía o con el vínculo de los saldos a favor ya grabados; no molesta a nada).
begin;

drop trigger if exists lz_anular_a_favor_de_cobro on public.movimientos;
drop trigger if exists lz_anular_a_favor_de_cobro_borrado on public.movimientos;

CREATE OR REPLACE FUNCTION public.registrar_cobro(p_factura_id uuid, p_lineas jsonb, p_fecha date, p_sociedad_id uuid, p_created_by uuid, p_conciliado boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_factura RECORD;
  v_linea JSONB;
  v_total_cobrado NUMERIC := 0;
  v_total_factura NUMERIC;
  v_inserted_ids UUID[] := '{}';
  v_new_id UUID;
BEGIN
  SELECT total, total_acreditado, cliente_id, moneda, tipo, punto_venta, numero, estado
  INTO v_factura
  FROM facturas
  WHERE id = p_factura_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Factura no encontrada';
  END IF;

  IF v_factura.estado NOT IN ('emitida', 'parcial') THEN
    RAISE EXCEPTION 'La factura no está en estado válido para cobro (estado: %)', v_factura.estado;
  END IF;

  -- Count existing cobros: individual movimientos + consolidated cobro_aplicaciones
  SELECT COALESCE(SUM(monto), 0) INTO v_total_cobrado
  FROM movimientos
  WHERE factura_id = p_factura_id;

  v_total_cobrado := v_total_cobrado + COALESCE((
    SELECT SUM(monto) FROM cobro_aplicaciones WHERE factura_id = p_factura_id
  ), 0);

  v_total_factura := v_factura.total - COALESCE(v_factura.total_acreditado, 0);

  FOR v_linea IN SELECT * FROM jsonb_array_elements(p_lineas)
  LOOP
    INSERT INTO movimientos (tipo, cliente_id, factura_id, descripcion, monto, moneda, fecha, conciliado, created_by, sociedad_id)
    VALUES (
      (v_linea->>'tipo')::movimiento_tipo,
      v_factura.cliente_id,
      p_factura_id,
      COALESCE(v_linea->>'descripcion', 'Cobro ' || v_factura.tipo || ' ' || LPAD(v_factura.punto_venta::text, 4, '0') || '-' || LPAD(v_factura.numero::text, 8, '0')),
      (v_linea->>'monto')::numeric,
      COALESCE(v_factura.moneda, 'ARS')::moneda_type,
      p_fecha,
      p_conciliado,
      p_created_by,
      p_sociedad_id
    )
    RETURNING id INTO v_new_id;
    v_inserted_ids := v_inserted_ids || v_new_id;
    v_total_cobrado := v_total_cobrado + (v_linea->>'monto')::numeric;
  END LOOP;

  IF v_total_cobrado >= v_total_factura THEN
    UPDATE facturas SET estado = 'pagada' WHERE id = p_factura_id;
  ELSE
    UPDATE facturas SET estado = 'parcial' WHERE id = p_factura_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'inserted_ids', to_jsonb(v_inserted_ids),
    'total_cobrado', v_total_cobrado,
    'pagada', v_total_cobrado >= v_total_factura
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.registrar_cobro_masivo(p_cliente_id uuid, p_facturas jsonb, p_medios jsonb, p_retenciones jsonb, p_fecha date, p_sociedad_id uuid, p_created_by uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_factura RECORD;
  v_medio JSONB;
  v_retencion JSONB;
  v_total_medios NUMERIC := 0;
  v_total_retenciones NUMERIC := 0;
  v_total_saldo NUMERIC := 0;
  v_proportion NUMERIC;
  v_aplicado NUMERIC;
  v_acum_aplicado NUMERIC;
  v_fac JSONB;
  v_fac_ids UUID[];
  v_inserted_ids UUID[] := '{}';
  v_new_id UUID;
  v_fac_numeros TEXT[] := '{}';
  v_desc_facturas TEXT;
  v_moneda TEXT;
  v_i INT := 0;
  v_fac_count INT;
  v_total_cobrado_prev NUMERIC;
  v_total_factura NUMERIC;
  v_medio_ids UUID[] := '{}';
BEGIN
  -- Calculate totals
  SELECT COALESCE(SUM((j->>'monto')::numeric), 0) INTO v_total_medios FROM jsonb_array_elements(p_medios) j;
  SELECT COALESCE(SUM((j->>'monto')::numeric), 0) INTO v_total_retenciones FROM jsonb_array_elements(p_retenciones) j;
  
  -- Lock and validate facturas
  v_fac_count := jsonb_array_length(p_facturas);
  FOR v_fac IN SELECT * FROM jsonb_array_elements(p_facturas)
  LOOP
    SELECT id, total, total_acreditado, estado, moneda INTO v_factura
    FROM facturas WHERE id = (v_fac->>'id')::uuid FOR UPDATE;
    
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Factura % no encontrada', v_fac->>'numero';
    END IF;
    IF v_factura.estado NOT IN ('emitida', 'parcial') THEN
      RAISE EXCEPTION 'Factura % no está en estado válido para cobro (estado: %)', v_fac->>'numero', v_factura.estado;
    END IF;
    
    v_total_saldo := v_total_saldo + (v_fac->>'saldo')::numeric;
    v_fac_ids := v_fac_ids || (v_fac->>'id')::uuid;
    v_fac_numeros := v_fac_numeros || (v_fac->>'numero');
    v_moneda := v_factura.moneda;
  END LOOP;

  v_desc_facturas := array_to_string(v_fac_numeros, ', ');

  -- Create ONE movimiento per medio
  FOR v_medio IN SELECT * FROM jsonb_array_elements(p_medios)
  LOOP
    INSERT INTO movimientos (tipo, cliente_id, factura_id, descripcion, monto, moneda, fecha, conciliado, created_by, sociedad_id)
    VALUES (
      (v_medio->>'tipo')::movimiento_tipo,
      p_cliente_id,
      NULL,
      COALESCE(v_medio->>'descripcion', 'Cobro') || ' — Facturas: ' || v_desc_facturas,
      (v_medio->>'monto')::numeric,
      COALESCE(v_moneda, 'ARS')::moneda_type,
      p_fecha,
      true,
      p_created_by,
      p_sociedad_id
    )
    RETURNING id INTO v_new_id;
    v_inserted_ids := v_inserted_ids || v_new_id;
    v_medio_ids := v_medio_ids || v_new_id;
  END LOOP;

  -- Create ONE movimiento per retención
  FOR v_retencion IN SELECT * FROM jsonb_array_elements(p_retenciones)
  LOOP
    INSERT INTO movimientos (tipo, cliente_id, factura_id, descripcion, monto, moneda, fecha, conciliado, created_by, sociedad_id)
    VALUES (
      (v_retencion->>'tipo')::movimiento_tipo,
      p_cliente_id,
      NULL,
      COALESCE(v_retencion->>'descripcion', 'Retención') || ' — Facturas: ' || v_desc_facturas,
      (v_retencion->>'monto')::numeric,
      COALESCE(v_moneda, 'ARS')::moneda_type,
      p_fecha,
      true,
      p_created_by,
      p_sociedad_id
    )
    RETURNING id INTO v_new_id;
    v_inserted_ids := v_inserted_ids || v_new_id;
  END LOOP;

  -- Distribute and create cobro_aplicaciones per factura
  v_acum_aplicado := 0;
  v_i := 0;
  FOR v_fac IN SELECT * FROM jsonb_array_elements(p_facturas)
  LOOP
    v_i := v_i + 1;
    
    IF v_i = v_fac_count THEN
      v_aplicado := ROUND((v_total_medios + v_total_retenciones) - v_acum_aplicado, 2);
    ELSE
      v_proportion := CASE WHEN v_total_saldo > 0 THEN (v_fac->>'saldo')::numeric / v_total_saldo ELSE 0 END;
      v_aplicado := ROUND((v_total_medios + v_total_retenciones) * v_proportion, 2);
    END IF;
    v_acum_aplicado := v_acum_aplicado + v_aplicado;

    -- Create cobro_aplicaciones linking the first medio movimiento to this factura
    -- (we link to the first medio for simplicity; the total applied is what matters)
    IF array_length(v_medio_ids, 1) > 0 THEN
      INSERT INTO cobro_aplicaciones (movimiento_id, factura_id, monto)
      VALUES (v_medio_ids[1], (v_fac->>'id')::uuid, v_aplicado);
    END IF;

    -- Check if factura is fully paid
    -- Sum existing cobros (individual movimientos + previous cobro_aplicaciones)
    SELECT COALESCE(SUM(monto), 0) INTO v_total_cobrado_prev
    FROM movimientos WHERE factura_id = (v_fac->>'id')::uuid;
    
    v_total_cobrado_prev := v_total_cobrado_prev + COALESCE((
      SELECT SUM(ca.monto) FROM cobro_aplicaciones ca 
      WHERE ca.factura_id = (v_fac->>'id')::uuid
    ), 0);

    SELECT total - COALESCE(total_acreditado, 0) INTO v_total_factura
    FROM facturas WHERE id = (v_fac->>'id')::uuid;

    IF v_total_cobrado_prev >= v_total_factura THEN
      UPDATE facturas SET estado = 'pagada' WHERE id = (v_fac->>'id')::uuid;
    ELSE
      UPDATE facturas SET estado = 'parcial' WHERE id = (v_fac->>'id')::uuid;
    END IF;
  END LOOP;

  -- Recalculate client saldo
  PERFORM recalcular_saldo_for_cliente(p_cliente_id);

  RETURN jsonb_build_object(
    'success', true,
    'inserted_ids', to_jsonb(v_inserted_ids),
    'movimientos_count', array_length(v_inserted_ids, 1),
    'facturas_count', v_fac_count,
    'total_cobrado', v_total_medios + v_total_retenciones
  );
END;
$function$
;

drop function if exists public.lz_anular_a_favor_de_cobro();
drop function if exists public.lz_estado_factura_por_cobro(uuid);
drop function if exists public.lz_cobrado_factura(uuid);

-- Igual que antes: solo se usan a través de las _seguro.
revoke execute on function public.registrar_cobro(uuid, jsonb, date, uuid, uuid, boolean) from public, anon, authenticated;
revoke execute on function public.registrar_cobro_masivo(uuid, jsonb, jsonb, jsonb, date, uuid, uuid) from public, anon, authenticated;

commit;
