-- Vuelta atrás de 20261014160000_pr_costo_envio_interno.sql (pierde lo cargado en esa columna).
begin;
alter table public.presupuestos drop column if exists costo_envio_interno;
commit;
