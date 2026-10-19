-- Aplicar el saldo a favor con un proveedor a una factura de compra (Augusto 19/10/2026).
-- Caso: a De Pascale se le paga antes (OP sin factura = anticipo) y la factura llega después.
-- SOLO AGREGA una función. No cambia tablas ni datos existentes.
--
-- Qué hace, todo junto o nada:
--   1. Vincula cada OP elegida a la factura (op_facturas_compra) por el monto indicado. La plata no se mueve.
--   2. Lo que sobra de esa OP queda a favor (saldos_favor_proveedor), igual que el excedente de una OP normal.
--   3. Si la factura queda cubierta, pasa a "pagada".
-- Lo que hay a favor en cada OP = bruto si no tenía facturas vinculadas + su saldo a favor disponible
-- (misma regla que lib/saldo-proveedores.ts → creditosProveedor y lib/saldo-favor-proveedor.ts).
-- Vuelta atrás: supabase/rollback/20261019200000_aplicar_saldo_favor_proveedor.sql

create or replace function public.aplicar_saldo_favor_proveedor(
  p_sociedad_id uuid,
  p_factura_id uuid,
  p_aplicaciones jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_factura public.facturas_compra%rowtype;
  v_item jsonb;
  v_op public.ordenes_pago%rowtype;
  v_sf public.saldos_favor_proveedor%rowtype;
  v_monto numeric;
  v_total numeric := 0;
  v_tiene_facturas boolean;
  v_disponible numeric;
  v_queda numeric;
  v_saldo_factura numeric;
  v_aplicadas jsonb := '[]'::jsonb;
begin
  if auth.uid() is null
    or not exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('super_admin', 'admin', 'administrativo')
    )
    or (
      exists (select 1 from public.user_sociedades us where us.user_id = auth.uid())
      and not exists (select 1 from public.user_sociedades us where us.user_id = auth.uid() and us.sociedad_id = p_sociedad_id)
    ) then
    raise exception 'No tenes permiso para aplicar pagos en esta sociedad';
  end if;

  if p_sociedad_id is null or p_factura_id is null
    or jsonb_typeof(p_aplicaciones) is distinct from 'array' or jsonb_array_length(p_aplicaciones) = 0 then
    raise exception 'Datos invalidos';
  end if;
  if (select count(*) <> count(distinct item->>'orden_pago_id') from jsonb_array_elements(p_aplicaciones) item) then
    raise exception 'Hay OP repetidas';
  end if;

  select * into v_factura from public.facturas_compra
  where id = p_factura_id and sociedad_id = p_sociedad_id
  for update;
  if not found then raise exception 'La factura no existe en esta sociedad'; end if;
  if upper(coalesce(v_factura.tipo_comprobante, '')) like 'NC%' then raise exception 'Es una nota de credito'; end if;
  if coalesce(v_factura.estado, '') not in ('pendiente', 'recibida') then
    raise exception 'La factura no esta pendiente de pago (estado %)', v_factura.estado;
  end if;

  -- Mismo candado que los pagos del proveedor: dos operaciones a la vez nunca usan el mismo saldo.
  perform pg_advisory_xact_lock(hashtextextended(p_sociedad_id::text || v_factura.proveedor_id::text, 0));

  v_saldo_factura := round(v_factura.total - public.fc_compra_pagado(p_factura_id, p_sociedad_id), 2);

  for v_item in select value from jsonb_array_elements(p_aplicaciones)
  loop
    v_monto := (v_item->>'monto')::numeric;
    if v_monto is null or v_monto <= 0 or v_monto <> round(v_monto, 2) then
      raise exception 'Monto invalido';
    end if;

    select * into v_op from public.ordenes_pago
    where id = (v_item->>'orden_pago_id')::uuid and sociedad_id = p_sociedad_id
    for update;
    if not found or v_op.proveedor_id is distinct from v_factura.proveedor_id then
      raise exception 'La OP no es de este proveedor';
    end if;
    if v_op.estado = 'anulada' then raise exception 'La OP % esta anulada', v_op.numero; end if;
    if coalesce(v_op.moneda, 'ARS') <> coalesce(v_factura.moneda, 'ARS')
      or (v_op.moneda_documentos is not null and v_op.moneda_documentos <> v_op.moneda) then
      raise exception 'La OP % es de otra moneda', v_op.numero;
    end if;

    v_tiene_facturas := exists (select 1 from public.op_facturas_compra a where a.orden_pago_id = v_op.id);
    select * into v_sf from public.saldos_favor_proveedor where orden_pago_id = v_op.id for update;
    v_disponible := round(
      (case when v_tiene_facturas then 0 else coalesce(v_op.monto_bruto, 0) end)
      + (case when found and v_sf.estado = 'disponible' then v_sf.saldo else 0 end), 2);
    if v_monto > v_disponible + 0.005 then
      raise exception 'La OP % tiene % a favor y se quiere aplicar %', v_op.numero, v_disponible, v_monto;
    end if;

    -- 1. Vincular (si ya estaba vinculada a esta factura, se suma).
    insert into public.op_facturas_compra (orden_pago_id, factura_compra_id, monto)
    values (v_op.id, p_factura_id, v_monto)
    on conflict (orden_pago_id, factura_compra_id) do update set monto = public.op_facturas_compra.monto + excluded.monto;

    -- 2. Lo que sobra de la OP queda a favor.
    v_queda := round(v_disponible - v_monto, 2);
    if v_sf.id is not null then
      update public.saldos_favor_proveedor
      set monto_original = greatest(monto_original, v_queda),
          saldo = v_queda,
          estado = case when v_queda > 0 then 'disponible' else 'aplicado' end,
          updated_at = now()
      where id = v_sf.id;
    elsif v_queda > 0 then
      insert into public.saldos_favor_proveedor (sociedad_id, proveedor_id, orden_pago_id, moneda, monto_original, saldo, created_by)
      values (p_sociedad_id, v_op.proveedor_id, v_op.id, coalesce(v_op.moneda, 'ARS'), v_queda, v_queda, auth.uid());
    end if;

    v_total := v_total + v_monto;
    v_aplicadas := v_aplicadas || jsonb_build_object('orden_pago_id', v_op.id, 'numero', v_op.numero, 'monto', v_monto, 'queda_a_favor', v_queda);
    v_sf := null;
  end loop;

  if v_total > v_saldo_factura + 0.005 then
    raise exception 'Se quiere aplicar % y la factura debe %', v_total, v_saldo_factura;
  end if;

  -- 3. Cubierta: pasa a pagada.
  update public.facturas_compra
  set estado = 'pagada'
  where id = p_factura_id
    and total - public.fc_compra_pagado(id, p_sociedad_id) <= 0.005;

  return jsonb_build_object(
    'factura_id', p_factura_id,
    'aplicado', v_total,
    'queda_en_factura', greatest(0, round(v_saldo_factura - v_total, 2)),
    'aplicaciones', v_aplicadas
  );
end;
$function$;

revoke all on function public.aplicar_saldo_favor_proveedor(uuid, uuid, jsonb) from public, anon;
grant execute on function public.aplicar_saldo_favor_proveedor(uuid, uuid, jsonb) to authenticated;
