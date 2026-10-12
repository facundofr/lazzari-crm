-- Vuelta atrás de 20261012190000_oc_diferencia_compartida.sql
-- Vuelve diagnostico_diferencia_oc a la versión de 20261012180000 (suma las facturas compartidas enteras). No toca datos.
begin;

create or replace function public.diagnostico_diferencia_oc(p_sociedad_id uuid, p_oc_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v jsonb;
begin
  if not public.lz_es_de_sociedad(p_sociedad_id) then
    raise exception 'No tenés acceso a esta sociedad' using errcode = '42501';
  end if;

  with oc as (
    select o.id, o.moneda::text as moneda, o.total, o.saldo_cerrado,
           (select coalesce(sum(i.cantidad * i.precio_unitario), 0) from orden_compra_items i where i.orden_id = o.id) as neto,
           (select coalesce(sum(i.cantidad), 0) from orden_compra_items i where i.orden_id = o.id) as cant_pedida,
           (select coalesce(sum(i.cantidad_recibida), 0) from orden_compra_items i where i.orden_id = o.id) as cant_recibida
    from ordenes_compra o
    where o.id = p_oc_id and o.sociedad_id = p_sociedad_id
  ), fcs as (
    select distinct f.id, f.subtotal, f.iva, f.total, f.estado, f.moneda::text as moneda,
           exists (select 1 from factura_compra_ocs l2 where l2.factura_compra_id = f.id and l2.orden_compra_id <> p_oc_id) as compartida
    from facturas_compra f
    where f.estado <> 'anulada'
      and coalesce(f.tipo_comprobante, '') !~* '^NC'
      and (f.orden_compra_id = p_oc_id
           or exists (select 1 from factura_compra_ocs l where l.factura_compra_id = f.id and l.orden_compra_id = p_oc_id))
  )
  select jsonb_build_object(
    'oc_neto', round(oc.neto, 2),
    'oc_total', oc.total,
    'moneda', oc.moneda,
    'saldo_cerrado', coalesce(oc.saldo_cerrado, false),
    'cant_pedida', oc.cant_pedida,
    'cant_recibida', oc.cant_recibida,
    'cant_facturada', (select sum(a.cantidad) from factura_compra_asignaciones a
                       join facturas_compra fa on fa.id = a.factura_compra_id
                       where a.orden_compra_id = p_oc_id and fa.estado <> 'anulada'),
    'n_facturas', (select count(*) from fcs),
    'fc_neto', (select coalesce(sum(subtotal), 0) from fcs),
    'fc_iva', (select coalesce(sum(iva), 0) from fcs),
    'fc_total', (select coalesce(sum(total), 0) from fcs),
    'todas_pagadas', (select count(*) > 0 and bool_and(estado = 'pagada') from fcs),
    'compartida', (select coalesce(bool_or(compartida), false) from fcs),
    'otra_moneda', (select coalesce(bool_or(coalesce(moneda, 'ARS') <> coalesce(oc.moneda, 'ARS')), false) from fcs),
    'ajuste_activo', exists (select 1 from lz_oc_ajustes a where a.oc_id = p_oc_id and not a.deshecho)
  )
  into v
  from oc;

  return v;
end;
$$;

revoke all on function public.diagnostico_diferencia_oc(uuid, uuid) from public, anon;
grant execute on function public.diagnostico_diferencia_oc(uuid, uuid) to authenticated;

commit;
