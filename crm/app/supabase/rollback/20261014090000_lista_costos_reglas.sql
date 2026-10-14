-- Vuelta atrás de 20261014090000_lista_costos_reglas.sql
-- Saca los triggers de sincronización, las tablas nuevas y la columna de foto.
-- No toca proveedores.descuento_pronto_pago (queda con el último valor que tenía).
-- El bucket "productos" se deja (puede tener fotos subidas); se borra a mano desde Storage si hace falta.

drop trigger if exists trg_sync_anticipado_desde_proveedor on public.proveedores;
drop trigger if exists trg_sync_anticipado_a_proveedores on public.proveedor_descuentos_opcionales;
drop function if exists public.sync_anticipado_desde_proveedor();
drop function if exists public.sync_anticipado_a_proveedores();

drop table if exists public.catalogo_cargas;
drop table if exists public.lista_costos_config;
drop table if exists public.margenes_venta;
drop table if exists public.proveedor_descuentos_opcionales;
drop table if exists public.proveedor_reglas;

alter table public.catalogo_costos drop column if exists foto_path;

notify pgrst, 'reload schema';
