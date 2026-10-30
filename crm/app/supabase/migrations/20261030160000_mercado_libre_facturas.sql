-- Compras Lazza › pestaña Mercado Libre (Augusto 30/10/2026): una fila por artículo de las OC a Mercado Libre y a cada una se le
-- carga (o se elige) su factura a mano. Nada se une solo.
-- La unión factura ↔ renglón de OC se guarda en factura_compra_asignaciones (la tabla que ya usaba la conciliación por renglón),
-- con origen 'mercado_libre'. Esa tabla solo se lee desde la pantalla: estas 2 funciones son la única forma de escribirla acá.
--   unir_factura_mercado_libre(factura, renglones): ata la factura a uno o varios renglones (una factura puede cubrir varios).
--   quitar_factura_mercado_libre(factura, renglón): deshace esa unión (solo las de origen 'mercado_libre'; la factura no cambia).
-- Después de unir o quitar, la OC recalcula «¿Está facturada?» (lz_actualizar_fact_pago_oc, la misma de siempre).
-- No cambia el costo del PR, ni la factura, ni el pago: solo el vínculo.
-- Solo AGREGA 2 funciones: no cambia tablas ni datos existentes.
-- Vuelta atrás: supabase/rollback/20261030160000_mercado_libre_facturas.sql
begin;

create or replace function public.unir_factura_mercado_libre(p_factura_id uuid, p_oc_item_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fc record;
  v_fc_item uuid;
  v_precio_fc numeric;
  v_n integer := 0;
  v_oc uuid;
begin
  if coalesce(get_my_role()::text, '') not in ('super_admin', 'admin', 'administrativo', 'vendedor') then
    raise exception 'No tenés permiso para unir facturas';
  end if;

  select id, sociedad_id, estado into v_fc from facturas_compra where id = p_factura_id;
  if not found then raise exception 'No se encontró la factura'; end if;
  if v_fc.estado = 'anulada' then raise exception 'La factura está anulada'; end if;

  -- La asignación pide un renglón de la factura: se usa el primero (las de Mercado Libre casi siempre tienen uno).
  select id, coalesce(precio_unitario, 0) into v_fc_item, v_precio_fc
  from facturas_compra_items where factura_compra_id = p_factura_id order by created_at, id limit 1;
  if v_fc_item is null then raise exception 'La factura no tiene renglones'; end if;

  if exists (select 1 from orden_compra_items i join ordenes_compra o on o.id = i.orden_id
             where i.id = any(p_oc_item_ids) and o.sociedad_id <> v_fc.sociedad_id) then
    raise exception 'La factura y la compra son de distinta sociedad';
  end if;

  insert into factura_compra_asignaciones (sociedad_id, factura_compra_id, factura_compra_item_id, orden_compra_id,
    orden_compra_item_id, cantidad, precio_factura, precio_oc, origen, created_by)
  select v_fc.sociedad_id, p_factura_id, v_fc_item, i.orden_id, i.id, i.cantidad, v_precio_fc, coalesce(i.precio_unitario, 0),
         'mercado_libre', auth.uid()
  from orden_compra_items i
  where i.id = any(p_oc_item_ids) and i.cantidad > 0
    and not exists (select 1 from factura_compra_asignaciones a
                    where a.factura_compra_id = p_factura_id and a.orden_compra_item_id = i.id);
  get diagnostics v_n = row_count;

  for v_oc in select distinct orden_id from orden_compra_items where id = any(p_oc_item_ids) loop
    perform lz_actualizar_fact_pago_oc(v_oc);
  end loop;

  return jsonb_build_object('unidos', v_n);
end $$;

create or replace function public.quitar_factura_mercado_libre(p_factura_id uuid, p_oc_item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer := 0;
  v_oc uuid;
begin
  if coalesce(get_my_role()::text, '') not in ('super_admin', 'admin', 'administrativo', 'vendedor') then
    raise exception 'No tenés permiso para quitar facturas';
  end if;

  select orden_id into v_oc from orden_compra_items where id = p_oc_item_id;
  delete from factura_compra_asignaciones
  where factura_compra_id = p_factura_id and orden_compra_item_id = p_oc_item_id and origen = 'mercado_libre';
  get diagnostics v_n = row_count;

  if v_oc is not null then perform lz_actualizar_fact_pago_oc(v_oc); end if;
  return jsonb_build_object('quitados', v_n);
end $$;

revoke all on function public.unir_factura_mercado_libre(uuid, uuid[]) from public, anon;
revoke all on function public.quitar_factura_mercado_libre(uuid, uuid) from public, anon;
grant execute on function public.unir_factura_mercado_libre(uuid, uuid[]) to authenticated;
grant execute on function public.quitar_factura_mercado_libre(uuid, uuid) to authenticated;

commit;
