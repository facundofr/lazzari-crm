-- Vuelta atrás de 20261028230000: el VEP vuelve a Impuestos y los dos textos a como estaban.
begin;
update public.gastos_manuales set categoria = 'Impuestos', grupo = 'Impuestos', descripcion = 'ARCA VEP — pago 16/10 (BBVA OP8808)' where id = '941ccae8-245e-4519-8e6a-65187b2217b5';
update public.movimientos set descripcion = 'Gasto — Impuestos — ARCA VEP — pago 16/10 (BBVA OP8808)' where id = '298a1d71-1ee1-40e1-855b-0ce09af82f51';
update public.gastos_manuales set descripcion = 'Pago por importación — Gaspar Federico Ovando' where id = '8a9fd4d3-f421-4324-a035-b70d9044af96';
update public.movimientos set descripcion = 'Gasto — Importaciones — Pago por importación — Gaspar Federico Ovando' where id = 'c338e6df-80d7-4c04-9f4c-6fe0c4c97a92';
commit;
