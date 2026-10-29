-- Vuelta atrás de 20261028231000: el VEP vuelve a Operativos con el texto de 20261028230000.
begin;
update public.gastos_manuales set categoria = 'Operativos', grupo = 'Operativos', descripcion = 'ARCA VEP — despacho de la importación (pago 16/10, BBVA OP8808)' where id = '941ccae8-245e-4519-8e6a-65187b2217b5';
update public.movimientos set descripcion = 'Gasto — Operativos — ARCA VEP — despacho de la importación (pago 16/10, BBVA OP8808)' where id = '298a1d71-1ee1-40e1-855b-0ce09af82f51';
commit;
