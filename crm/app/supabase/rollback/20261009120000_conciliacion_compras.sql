-- Deshace supabase/migrations/20261009120000_conciliacion_compras.sql
-- Las facturas cargadas con la conciliación NO se borran: quedan como facturas comunes.
-- Las que estaban en "Conciliación parcial" pasan a "pendiente_aprobacion".
-- Se pierde el detalle de qué línea de factura cubre qué línea de OC y las equivalencias aprendidas.

begin;
drop function if exists public.guardar_conciliacion_compra(uuid, uuid, jsonb, jsonb, jsonb, boolean, boolean, jsonb);
drop view if exists public.orden_compra_items_pendientes;
drop table if exists public.proveedor_equivalencias;
drop table if exists public.factura_compra_asignaciones;
alter table public.ordenes_compra drop constraint if exists ordenes_compra_estado_facturacion_check;
alter table public.ordenes_compra drop column if exists estado_facturacion;
update public.facturas_compra set estado = 'pendiente_aprobacion' where estado = 'en_conciliacion';
alter table public.facturas_compra drop constraint if exists facturas_compra_estado_check;
alter table public.facturas_compra add constraint facturas_compra_estado_check
  check (estado = any (array['pendiente','pagada','anulada','recibida','pendiente_aprobacion']));
commit;
