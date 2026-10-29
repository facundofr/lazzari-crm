-- 28/10/2026 (Augusto): en Gastos, un grupo nuevo "Premios", seguido a Sueldos (los premios de un mes se pagan al mes siguiente, con el sueldo).
-- Aditivo: solo agrega el valor 'Premios' a los dos checks de la columna grupo. Vuelta atrás: supabase/rollback/20261028210000_gastos_grupo_premios.sql
begin;

alter table public.gastos_manuales drop constraint if exists gastos_manuales_grupo_check;
alter table public.gastos_manuales add constraint gastos_manuales_grupo_check check (grupo is null or grupo in
  ('Personal', 'Premios', 'Local y servicios', 'Profesionales', 'Impuestos', 'Bancos y financieros', 'Operativos', 'Personales'));

alter table public.gastos_fijos drop constraint if exists gastos_fijos_grupo_check;
alter table public.gastos_fijos add constraint gastos_fijos_grupo_check check (grupo is null or grupo in
  ('Personal', 'Premios', 'Local y servicios', 'Profesionales', 'Impuestos', 'Bancos y financieros', 'Operativos', 'Personales'));

commit;
