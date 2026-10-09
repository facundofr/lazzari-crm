-- Deshace 20261009200000_descuentos_presupuesto.sql.
-- OJO: los presupuestos guardados con descuento conservan su precio neto en precio_venta (no se pierde plata),
-- pero se pierde el dato de precio de lista y % de descuento.
drop table if exists public.notificaciones;
alter table public.presupuestos drop column if exists descuento_general_porcentaje;
alter table public.presupuesto_items drop column if exists descuento_porcentaje;
alter table public.presupuesto_items drop column if exists precio_lista;
-- La función guardar_conciliacion_compra se puede volver a la versión anterior corriendo de nuevo
-- supabase/migrations/20261009120000_conciliacion_compras.sql
