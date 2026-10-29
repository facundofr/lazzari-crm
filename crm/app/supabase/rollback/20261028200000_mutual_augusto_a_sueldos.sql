-- Vuelta atrás de 20261028200000: la mutual de Augusto vuelve a Personales.
begin;
update public.gastos_fijos set categoria = 'Personales', grupo = 'Personales' where id = '6a8fef61-c882-4fc3-90f2-320720ef89cf';
update public.gastos_manuales set categoria = 'Personales', grupo = 'Personales' where id = '8319c96d-64d7-4d76-8e27-ba8efc396ddd';
commit;
