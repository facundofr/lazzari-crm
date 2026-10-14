-- Vuelta atrás de 20261013200000_datos_reactivar_op4_op43.sql: deja OP-000004 y OP-000043 como estaban (anuladas).
begin;

update public.ordenes_pago
set estado = 'anulada', fecha = '2026-09-09', medio_pago = 'echeq',
    medios_pago = to_jsonb('[{"tipo":"echeq","monto":162750.06,"fecha":"2026-10-31","banco":"BBVA","numero_cheque":"90000170","moneda":"ARS","cotizacion":1},{"tipo":"echeq","monto":162750.06,"fecha":"2026-10-31","banco":"BBVA","numero_cheque":"90000169","moneda":"ARS","cotizacion":1}]'::text),
    notas = '', updated_at = now()
where id = 'd20c121a-1f9e-4b84-8d9c-d31d169482d0';

update public.movimientos set fecha = '2026-09-09' where id = '023040ee-4e1c-4a0d-be63-dc995da01311';

update public.ordenes_pago
set estado = 'anulada', monto_bruto = 626200.41, neto_a_pagar = 620329.99,
    retencion_ganancias_monto = 5870.42, retencion_ganancias_pct = 2, base_retencion_ganancias = 517521,
    notas = null, updated_at = now()
where id = '68653961-1135-4528-b9a8-65530927f6de';

update public.op_facturas_compra set monto = 626200.41 where id = 'b032eaa5-f6af-47f3-9ca8-4917e8ec426d';

commit;
