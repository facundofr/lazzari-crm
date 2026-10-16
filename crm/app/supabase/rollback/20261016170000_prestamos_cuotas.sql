-- Vuelta atrás de 20261016170000_prestamos_cuotas.sql: borra solo las tablas nuevas de préstamos y cuotas (con los créditos BNA cargados ahí).
-- No toca lineas_credito ni ninguna otra tabla.
begin;
drop table if exists public.prestamo_cuotas;
drop table if exists public.prestamos;
commit;
