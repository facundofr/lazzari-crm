-- Vuelta atrás de 20261013231000_gasto_fijo_proveedor.sql: saca la columna (se pierde solo el proveedor cargado en ella).
begin;
drop index if exists public.gastos_fijos_proveedor_idx;
alter table public.gastos_fijos drop column if exists proveedor_id;
commit;
