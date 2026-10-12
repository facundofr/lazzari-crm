-- Cartel "OC con diferencia": facturas repartidas entre varias OC — 12/10/2026, con OK de Augusto ("Va 1 a 4").
--
-- Error: diagnostico_diferencia_oc sumaba la factura ENTERA aunque estuviera repartida entre varias OC.
-- Ej.: OC-2026-1199 (TKW) decía "Facturado y pagado $5.833.748,89 de $2.412.764,36 (141,8 % de más)" porque la
-- FC 0002-00036698 ($4.053.677,31) se reparte entre las OC 1187, 1188, 1192, 1199 y 1204.
-- Ahora, de una factura compartida cuenta solo lo asignado a esta OC (renglones conciliados: cantidad × precio de la factura),
-- con el mismo IVA/percepciones que la factura (proporción total / neto). Si la factura compartida no tiene renglones
-- conciliados, se reparte según el total de cada OC vinculada (ej. OC-1053 + OC-1075 = la factura entera).
--
-- Solo reemplaza UNA función de lectura. No toca datos.
-- Vuelta atrás: supabase/rollback/20261012190000_oc_diferencia_compartida.sql
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
  ), fcs0 as (
    select distinct f.id, f.subtotal, f.iva, f.total, f.estado, f.moneda::text as moneda,
           exists (select 1 from factura_compra_ocs l2 where l2.factura_compra_id = f.id and l2.orden_compra_id <> p_oc_id) as compartida
    from facturas_compra f
    where f.estado <> 'anulada'
      and coalesce(f.tipo_comprobante, '') !~* '^NC'
      and (f.orden_compra_id = p_oc_id
           or exists (select 1 from factura_compra_ocs l where l.factura_compra_id = f.id and l.orden_compra_id = p_oc_id))
  ), fcs1 as (
    -- Qué parte de cada factura le toca a esta OC (1 = toda).
    select f.*,
           case
             when not f.compartida then 1
             when asg.neto is not null and coalesce(f.subtotal, 0) > 0 then asg.neto / f.subtotal
             when coalesce(rep.total_ocs, 0) > 0 then (select o.total from oc o) / rep.total_ocs
             else 1
           end as parte
    from fcs0 f
    left join lateral (
      select sum(a.cantidad * a.precio_factura) as neto
      from factura_compra_asignaciones a
      where a.factura_compra_id = f.id and a.orden_compra_id = p_oc_id
    ) asg on true
    left join lateral (
      select sum(o2.total) as total_ocs
      from (select distinct l3.orden_compra_id from factura_compra_ocs l3 where l3.factura_compra_id = f.id) x
      join ordenes_compra o2 on o2.id = x.orden_compra_id and o2.estado <> 'cancelada'
    ) rep on true
  ), fcs as (
    select id, estado, moneda, compartida,
           round(coalesce(subtotal, 0) * parte, 2) as subtotal,
           round(coalesce(iva, 0) * parte, 2) as iva,
           round(coalesce(total, 0) * parte, 2) as total
    from fcs1
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
