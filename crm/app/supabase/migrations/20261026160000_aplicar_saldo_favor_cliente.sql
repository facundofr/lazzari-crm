-- Aplicar el saldo a favor de un cliente a sus facturas al registrar un cobro (Augusto 26/10/2026:
-- "que el sistema también mire la cuenta corriente a la hora de aplicar un cobro").
-- Caso: Del Sol pagó la FA 0015-00000039 que después se anuló; esa plata quedó a favor y la OP siguiente la descontó.
-- SOLO AGREGA una función. No cambia tablas ni datos existentes.
--
-- Saldo a favor de un cliente = movimientos "ajuste" con ajuste_sentido = 'credito', sin factura y sin anular
-- (pagos de más que deja registrar_cobro_masivo, la factura anulada de Del Sol, ajustes manuales de crédito).
-- Misma regla que lib/saldo-clientes.ts (ajustes) y lib/saldo-favor-cliente.ts.
--
-- Qué hace, todo junto o nada, por cada {movimiento_id, factura_id, monto}:
--   - Si se aplica todo el saldo a favor de ese movimiento, el movimiento queda atado a la factura.
--   - Si se aplica una parte, el movimiento baja a lo que sobra (sigue a favor) y se agrega uno nuevo
--     por la parte aplicada, atado a la factura (mismo cobro de origen, así si se anula el cobro se anulan los dos).
--   - La factura pasa a parcial o pagada con la misma regla que los cobros (lz_estado_factura_por_cobro).
-- Nada se aplica solo: lo pide una persona desde la Liquidación de cobro.
-- Vuelta atrás: supabase/rollback/20261026160000_aplicar_saldo_favor_cliente.sql

create or replace function public.aplicar_saldo_favor_cliente(
  p_sociedad_id uuid,
  p_cliente_id uuid,
  p_aplicaciones jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_item jsonb;
  v_mov public.movimientos%rowtype;
  v_factura public.facturas%rowtype;
  v_monto numeric;
  v_saldo_factura numeric;
  v_comprobante text;
  v_new_id uuid;
  v_total numeric := 0;
  v_aplicadas jsonb := '[]'::jsonb;
begin
  if auth.uid() is null
    or not exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('super_admin', 'admin', 'administrativo')
    )
    or not exists (
      select 1 from public.user_sociedades us
      where us.user_id = auth.uid() and us.sociedad_id = p_sociedad_id
    ) then
    raise exception 'No tenes permiso para aplicar saldos a favor en esta sociedad';
  end if;

  if p_sociedad_id is null or p_cliente_id is null
    or jsonb_typeof(p_aplicaciones) is distinct from 'array' or jsonb_array_length(p_aplicaciones) = 0 then
    raise exception 'Datos invalidos';
  end if;

  if not exists (select 1 from public.clientes c where c.id = p_cliente_id and c.sociedad_id = p_sociedad_id) then
    raise exception 'El cliente no pertenece a la sociedad activa';
  end if;

  -- Mismo candado por cliente: dos personas a la vez nunca usan el mismo saldo a favor.
  perform pg_advisory_xact_lock(hashtextextended(p_sociedad_id::text || p_cliente_id::text, 0));

  for v_item in select value from jsonb_array_elements(p_aplicaciones)
  loop
    v_monto := (v_item->>'monto')::numeric;
    if v_monto is null or v_monto <= 0 or v_monto <> round(v_monto, 2) then
      raise exception 'Monto invalido';
    end if;

    select * into v_mov from public.movimientos
    where id = (v_item->>'movimiento_id')::uuid and sociedad_id = p_sociedad_id
    for update;
    if not found or v_mov.cliente_id is distinct from p_cliente_id then
      raise exception 'El saldo a favor no es de este cliente';
    end if;
    if coalesce(v_mov.anulado, false) or v_mov.factura_id is not null
      or v_mov.tipo::text <> 'ajuste' or coalesce(v_mov.ajuste_sentido, '') <> 'credito'
      or exists (select 1 from public.cobro_aplicaciones ca where ca.movimiento_id = v_mov.id) then
      raise exception 'Ese saldo a favor ya no esta disponible (se aplico o se anulo). Volve a abrir el cobro.';
    end if;
    if v_monto > v_mov.monto + 0.005 then
      raise exception 'El saldo a favor es % y se quiere aplicar %', v_mov.monto, v_monto;
    end if;

    select * into v_factura from public.facturas
    where id = (v_item->>'factura_id')::uuid and sociedad_id = p_sociedad_id and cliente_id = p_cliente_id
    for update;
    if not found then raise exception 'La factura no es de este cliente'; end if;
    if v_factura.estado::text = 'anulada' or upper(coalesce(v_factura.tipo::text, '')) like 'NC%' then
      raise exception 'No se puede aplicar a una factura anulada o a una nota de credito';
    end if;
    if coalesce(v_factura.moneda::text, 'ARS') <> coalesce(v_mov.moneda::text, 'ARS') then
      raise exception 'El saldo a favor es de otra moneda que la factura';
    end if;

    v_saldo_factura := round(v_factura.total - coalesce(v_factura.total_acreditado, 0) - public.lz_cobrado_factura(v_factura.id), 2);
    if v_monto > v_saldo_factura + 0.005 then
      raise exception 'Se quiere aplicar % y la factura debe %', v_monto, v_saldo_factura;
    end if;

    v_comprobante := coalesce(v_factura.tipo::text, '') || ' ' || lpad(v_factura.punto_venta::text, 4, '0') || '-' || lpad(v_factura.numero::text, 8, '0');

    if v_monto >= v_mov.monto - 0.005 then
      update public.movimientos
      set factura_id = v_factura.id,
          descripcion = descripcion || ' — aplicado a la ' || v_comprobante
      where id = v_mov.id;
      v_new_id := v_mov.id;
    else
      update public.movimientos
      set monto = round(monto - v_monto, 2),
          descripcion = descripcion || ' — se aplicaron ' || to_char(v_monto, 'FM999999999990.00') || ' a la ' || v_comprobante
      where id = v_mov.id;
      insert into public.movimientos (
        tipo, cliente_id, factura_id, descripcion, monto, moneda, fecha, conciliado, created_by, sociedad_id, ajuste_sentido, cobro_origen_id
      ) values (
        'ajuste', p_cliente_id, v_factura.id,
        'Saldo a favor aplicado a la ' || v_comprobante || ' (de: ' || coalesce(v_mov.descripcion, '') || ')',
        v_monto, v_mov.moneda, current_date, v_mov.conciliado, auth.uid(), p_sociedad_id, 'credito', v_mov.cobro_origen_id
      )
      returning id into v_new_id;
    end if;

    perform public.lz_estado_factura_por_cobro(v_factura.id);

    v_total := v_total + v_monto;
    v_aplicadas := v_aplicadas || jsonb_build_object('movimiento_id', v_new_id, 'factura_id', v_factura.id, 'comprobante', v_comprobante, 'monto', v_monto);
  end loop;

  return jsonb_build_object('aplicado', round(v_total, 2), 'aplicaciones', v_aplicadas);
end;
$function$;

revoke all on function public.aplicar_saldo_favor_cliente(uuid, uuid, jsonb) from public, anon;
grant execute on function public.aplicar_saldo_favor_cliente(uuid, uuid, jsonb) to authenticated;
