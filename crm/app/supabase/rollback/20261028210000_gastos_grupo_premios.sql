-- Vuelta atrás de 20261028210000. OJO: falla si ya hay gastos del grupo 'Premios'; antes hay que pasarlos a otro grupo (o correr el rollback de 20261028211000).
begin;
alter table public.gastos_manuales drop constraint if exists gastos_manuales_grupo_check;
alter table public.gastos_manuales add constraint gastos_manuales_grupo_check check (grupo is null or grupo in
  ('Personal', 'Local y servicios', 'Profesionales', 'Impuestos', 'Bancos y financieros', 'Operativos', 'Personales'));
alter table public.gastos_fijos drop constraint if exists gastos_fijos_grupo_check;
alter table public.gastos_fijos add constraint gastos_fijos_grupo_check check (grupo is null or grupo in
  ('Personal', 'Local y servicios', 'Profesionales', 'Impuestos', 'Bancos y financieros', 'Operativos', 'Personales'));
commit;
