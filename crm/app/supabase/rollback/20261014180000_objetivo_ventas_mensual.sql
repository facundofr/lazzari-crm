-- Vuelta atrás de 20261014180000_objetivo_ventas_mensual.sql: borra el objetivo cargado y la columna sociedad_id.
begin;
delete from public.objetivos
where nombre = 'Ventas del mes (neto, sin IVA)' and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021';
drop index if exists public.objetivos_sociedad_idx;
alter table public.objetivos drop column if exists sociedad_id;
commit;
