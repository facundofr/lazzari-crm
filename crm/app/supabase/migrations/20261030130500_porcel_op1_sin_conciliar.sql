-- Auditoría de la plata (30/10/2026, Tanda A punto 7): la OP-000001 de Grupo LA (Porcel Leandro, $ 500.000, 09/09, transferencia
-- Galicia) figura "conciliada" sin línea del banco: Grupo LA no tiene ningún extracto cargado y es su único movimiento conciliado.
-- Pasa a "sin conciliar", como los demás de Grupo LA, para que se cruce con su línea cuando se carguen los extractos del Galicia
-- (si no, esa línea quedaría suelta y se podría cargar como otro pago). El pago y la OP no cambian.
-- Vuelta atrás: supabase/rollback/20261030130500_porcel_op1_sin_conciliar.sql
begin;
update public.movimientos set conciliado = false
 where id = '3e4ebe86-69c3-4cff-90ff-c7b643ad0417' and conciliado and extracto_movimiento_id is null
   and not exists (select 1 from public.extracto_movimientos em where em.match_movimiento_id = '3e4ebe86-69c3-4cff-90ff-c7b643ad0417');
commit;
