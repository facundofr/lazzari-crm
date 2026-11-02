-- Auditoría de la plata (30/10/2026, Tanda B, chat Ventas y facturación; §4.9): la factura manual (comprobante X, sin ARCA) se
-- guarda en UNA transacción: cabecera y renglones juntos o nada. Antes el servidor insertaba la factura y después los renglones
-- en dos pasos; si fallaba el segundo, quedaba una factura sin renglones (el error solo iba al log).
-- Es SECURITY INVOKER: corre con los permisos (RLS) del usuario, igual que los dos inserts de antes. Los importes y las
-- validaciones (talonario, fecha, número, cliente) los sigue haciendo /api/facturacion antes de llamarla.
-- Aditivo: solo agrega una función. Vuelta atrás: supabase/rollback/20261102120100_factura_manual_una_operacion.sql
begin;

create or replace function public.registrar_factura_manual(p_factura jsonb, p_items jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_factura public.facturas%rowtype;
begin
  if p_factura is null or jsonb_typeof(p_factura) <> 'object'
    or p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0
  then
    raise exception 'Faltan la factura o sus renglones' using errcode = '22023';
  end if;

  insert into public.facturas (
    tipo, punto_venta, numero, cliente_id, presupuesto_id, fecha, cae, cae_vencimiento,
    subtotal, iva, total, moneda, tipo_cambio, cotizacion_modalidad, estado, sociedad_id,
    oc_cliente, oc_cliente_fecha, solicitado_por, observaciones, condicion_venta, fecha_vencimiento, nota_interna
  ) values (
    (p_factura->>'tipo')::public.comprobante_type,
    (p_factura->>'punto_venta')::integer,
    (p_factura->>'numero')::integer,
    nullif(p_factura->>'cliente_id', '')::uuid,
    nullif(p_factura->>'presupuesto_id', '')::uuid,
    (p_factura->>'fecha')::date,
    null, null,
    (p_factura->>'subtotal')::numeric,
    (p_factura->>'iva')::numeric,
    (p_factura->>'total')::numeric,
    p_factura->>'moneda',
    nullif(p_factura->>'tipo_cambio', '')::numeric,
    nullif(p_factura->>'cotizacion_modalidad', ''),
    'emitida'::public.factura_status,
    (p_factura->>'sociedad_id')::uuid,
    nullif(p_factura->>'oc_cliente', ''),
    nullif(p_factura->>'oc_cliente_fecha', '')::date,
    nullif(p_factura->>'solicitado_por', ''),
    nullif(p_factura->>'observaciones', ''),
    nullif(p_factura->>'condicion_venta', ''),
    nullif(p_factura->>'fecha_vencimiento', '')::date,
    nullif(p_factura->>'nota_interna', '')
  )
  returning * into v_factura;

  insert into public.factura_items (factura_id, descripcion, cantidad, precio_unitario, iva_porcentaje, orden)
  select v_factura.id,
         coalesce(nullif(btrim(i.value->>'descripcion'), ''), 'Item'),
         (i.value->>'cantidad')::numeric,
         (i.value->>'precio_unitario')::numeric,
         coalesce((i.value->>'iva_porcentaje')::numeric, 21),
         coalesce((i.value->>'orden')::integer, (i.ordinality - 1)::integer)
  from jsonb_array_elements(p_items) with ordinality as i(value, ordinality);

  return to_jsonb(v_factura);
end;
$$;

revoke all on function public.registrar_factura_manual(jsonb, jsonb) from public, anon;
grant execute on function public.registrar_factura_manual(jsonb, jsonb) to authenticated;

comment on function public.registrar_factura_manual(jsonb, jsonb) is
  'Factura manual (X, sin ARCA): cabecera y renglones en una sola transacción. Auditoría de la plata 30/10/2026.';

commit;
