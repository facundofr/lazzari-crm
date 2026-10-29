-- Vuelta atrás de 20261028211000: borra solo los 8 gastos de esa carga (marca [sueldos-07/10]) y sus pagos.
begin;
delete from public.movimientos where gasto_manual_id in (select id from public.gastos_manuales where notas like '%[sueldos-07/10]');
delete from public.gastos_manuales where notas like '%[sueldos-07/10]';
commit;
