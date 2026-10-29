-- 28/10/2026 (Augusto): el VEP de $ 2.520.000 del 16/10 fue el despacho de la importación (va a Operativos, no a Impuestos) y la transferencia a
-- Gaspar Federico Ovando ($ 2.680.080, 22/09) fue el pago de la mercadería importada (es COSTO de mercadería; se deja en Importaciones y se aclara en el texto).
-- Aditivo: solo cambian categoría, grupo y texto de 2 gastos y de sus pagos. Vuelta atrás: supabase/rollback/20261028230000_importacion_vep_y_mercaderia.sql
begin;

update public.gastos_manuales
set categoria = 'Operativos', grupo = 'Operativos', descripcion = 'ARCA VEP — despacho de la importación (pago 16/10, BBVA OP8808)'
where id = '941ccae8-245e-4519-8e6a-65187b2217b5' and categoria = 'Impuestos';
update public.movimientos
set descripcion = 'Gasto — Operativos — ARCA VEP — despacho de la importación (pago 16/10, BBVA OP8808)'
where id = '298a1d71-1ee1-40e1-855b-0ce09af82f51' and descripcion = 'Gasto — Impuestos — ARCA VEP — pago 16/10 (BBVA OP8808)';

update public.gastos_manuales
set descripcion = 'Mercadería importada (costo) — pago a Gaspar Federico Ovando'
where id = '8a9fd4d3-f421-4324-a035-b70d9044af96' and descripcion = 'Pago por importación — Gaspar Federico Ovando';
update public.movimientos
set descripcion = 'Gasto — Importaciones — Mercadería importada (costo) — pago a Gaspar Federico Ovando'
where id = 'c338e6df-80d7-4c04-9f4c-6fe0c4c97a92' and descripcion = 'Gasto — Importaciones — Pago por importación — Gaspar Federico Ovando';

commit;
