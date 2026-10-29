-- 28/10/2026 (Augusto): la mutual de Augusto (Mutual Sancor Salud) se cuenta como sueldos (para Contabilidad). Pasa de Personales a Sueldos (grupo Personal).
-- Aditivo: solo cambia la categoría y el grupo de 2 filas (el gasto fijo y el gasto de octubre). Vuelta atrás: supabase/rollback/20261028200000_mutual_augusto_a_sueldos.sql
begin;

update public.gastos_fijos set categoria = 'Sueldos', grupo = 'Personal' where id = '6a8fef61-c882-4fc3-90f2-320720ef89cf' and categoria = 'Personales';
update public.gastos_manuales set categoria = 'Sueldos', grupo = 'Personal' where id = '8319c96d-64d7-4d76-8e27-ba8efc396ddd' and categoria = 'Personales';

commit;
