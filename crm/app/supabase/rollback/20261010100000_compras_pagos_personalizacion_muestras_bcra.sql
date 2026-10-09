-- Deshace 20261010100000_compras_pagos_personalizacion_muestras_bcra.sql
-- ATENCIÓN: borra lo cargado en Plan de pagos, Personalización e informes BCRA.
-- Las columnas nuevas de OC, proveedores, presupuestos y muestras se dejan (no molestan).

begin;

drop table if exists public.cliente_bcra_informes;
drop table if exists public.personalizacion_items;
drop table if exists public.personalizacion_trabajos;
drop table if exists public.personalizacion_liquidaciones;
drop table if exists public.personalizacion_logos;
drop table if exists public.personalizacion_precios;
drop table if exists public.pagos_lote_items;
drop table if exists public.pagos_lotes;

drop function if exists public.normalizar_items_oc(uuid, jsonb);
drop function if exists public.cerrar_saldo_oc(uuid, uuid, boolean, text);
drop function if exists public.aprender_equivalencias(uuid, uuid, jsonb);

-- Vista como estaba antes
drop view if exists public.orden_compra_items_pendientes;
create view public.orden_compra_items_pendientes with (security_invoker = true) as
select i.id, i.orden_id, i.codigo, i.descripcion, i.cantidad, i.precio_unitario, i.iva_porcentaje, i.unidad, i.orden,
       coalesce(a.asignada, 0) as cantidad_asignada,
       i.cantidad - coalesce(a.asignada, 0) as cantidad_pendiente
from public.orden_compra_items i
left join (
  select orden_compra_item_id, sum(cantidad) as asignada
  from public.factura_compra_asignaciones group by orden_compra_item_id
) a on a.orden_compra_item_id = i.id;
grant select on public.orden_compra_items_pendientes to authenticated;

commit;
