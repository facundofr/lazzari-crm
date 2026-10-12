-- COPIA DE LECTURA (no correr): definición de public.registrar_cobro_masivo tal como está en Supabase al 12/10/2026.
-- La hizo Manu a mano; no estaba en el repo. Sacada con supabase/diagnostico/ver_registrar_cobro_masivo.sql.
-- Reparte lo cobrado EN PROPORCIÓN al "saldo" de cada factura del pedido y la última se lleva el resto;
-- el estado (pagada/parcial) lo calcula con movimientos + cobro_aplicaciones vs total - total_acreditado.
-- La pantalla usa lib/cobro-reparto.ts (facturasParaRegistrar) para que el faltante quede en la factura más nueva.

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
