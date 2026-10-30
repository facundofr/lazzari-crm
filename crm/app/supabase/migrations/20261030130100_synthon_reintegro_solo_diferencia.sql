-- Auditoría de la plata (30/10/2026, Tanda A punto 7, D2, confirmado por Augusto 29/10): el "Reintegro a Sebastián Pereyra por compras
-- para Synthon" ($ 575.000, 23/09) pagó los 2 parlantes Jabra que ya son costo del PR-2026-1143 (2 × 259.225,27 = 518.450,54, FA 15-29):
-- contados dos veces. El gasto queda solo con lo que Seba pagó de más: $ 56.549,46. El PR y la comisión no se tocan.
-- El pago de $ 575.000 queda igual, atado al gasto y cruzado con el banco el 23/09 (con la Tanda A, editar el gasto sin cambiarle el
-- monto ya no toca el monto del pago).
-- Vuelta atrás: supabase/rollback/20261030130100_synthon_reintegro_solo_diferencia.sql
begin;

update public.gastos_manuales
   set monto = 56549.46,
       descripcion = 'Reintegro a Sebastián Pereyra por compras para Synthon — lo pagado de más sobre el costo del PR-2026-1143',
       notas = concat_ws(' · ', nullif(notas, ''), 'Auditoría de la plata 30/10/2026: la transferencia fue de $ 575.000; $ 518.450,54 son los 2 parlantes Jabra que ya son costo del PR-2026-1143 (FA 15-29), así que el gasto es solo la diferencia. El pago de $ 575.000 queda igual, cruzado con el banco.')
 where id = 'c6d4951d-ba21-4651-87a0-a2a16b7b974f' and monto = 575000;

commit;
