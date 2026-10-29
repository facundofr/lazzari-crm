-- 28/10/2026 (Augusto): el VEP de $ 2.520.000 del 16/10 (despacho de la importación) vuelve a Impuestos, pero con el texto aclarado.
-- Aditivo: solo cambian categoría, grupo y texto de 1 gasto y de su pago. Vuelta atrás: supabase/rollback/20261028231000_vep_importacion_vuelve_a_impuestos.sql
begin;

update public.gastos_manuales
set categoria = 'Impuestos', grupo = 'Impuestos', descripcion = 'ARCA VEP — impuestos de la importación (despacho) — pago 16/10 (BBVA OP8808)'
where id = '941ccae8-245e-4519-8e6a-65187b2217b5';
update public.movimientos
set descripcion = 'Gasto — Impuestos — ARCA VEP — impuestos de la importación (despacho) — pago 16/10 (BBVA OP8808)'
where id = '298a1d71-1ee1-40e1-855b-0ce09af82f51';

commit;
