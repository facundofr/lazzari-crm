-- Vuelta atrás de 20261029140000: borra los 3 gastos del 06/10 (y sus pagos), el gasto fijo del interés y devuelve la línea del banco a pendiente.
begin;
delete from public.movimientos where gasto_manual_id in (select id from public.gastos_manuales where notas like '%[jose-0610]');
delete from public.gastos_manuales where notas like '%[jose-0610]';
delete from public.gastos_fijos where id = '6a1f0c10-0001-4e00-9a00-0000000000a1'
  and not exists (select 1 from public.gastos_manuales where gasto_fijo_id = '6a1f0c10-0001-4e00-9a00-0000000000a1');
update public.extracto_movimientos set estado = 'pendiente',
  nota = 'Pago por transferencia: $ 560.000,00 — Viajes y comisiones por ventas — José Enrique Alvarez (CUIT 20-04693136-0). Según Augusto 16/10/2026 (destinatario del resumen/comprobantes BBVA).'
where id = '6c0e9859-b0ec-4c15-a6fd-e40e63e94a3a';
commit;
