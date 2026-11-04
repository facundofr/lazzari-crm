-- Vuelta atrás de 20261103210000_gastos_grupos.sql
-- ⚠️ Antes de correrla, volver el código a la versión anterior (la nueva lee gastos_grupos).
-- No borra ni cambia ningún gasto. Los checks vuelven como NOT VALID: no revisan los gastos que ya estén en una pestaña nueva
-- (esos quedan con su grupo y la pantalla vieja los muestra según su categoría); sí frenan grupos nuevos desde ahora.
begin;
alter table public.gastos_manuales drop constraint if exists gastos_manuales_grupo_check;
alter table public.gastos_manuales add constraint gastos_manuales_grupo_check check ((grupo is null) or (grupo = any (array['Personal'::text, 'Premios'::text, 'Local y servicios'::text, 'Profesionales'::text, 'Impuestos'::text, 'Bancos y financieros'::text, 'Operativos'::text, 'Personales'::text]))) not valid;
alter table public.gastos_fijos drop constraint if exists gastos_fijos_grupo_check;
alter table public.gastos_fijos add constraint gastos_fijos_grupo_check check ((grupo is null) or (grupo = any (array['Personal'::text, 'Premios'::text, 'Local y servicios'::text, 'Profesionales'::text, 'Impuestos'::text, 'Bancos y financieros'::text, 'Operativos'::text, 'Personales'::text]))) not valid;
drop table if exists public.gastos_grupos;
commit;
