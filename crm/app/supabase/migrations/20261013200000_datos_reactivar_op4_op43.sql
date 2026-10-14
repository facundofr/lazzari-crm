-- Datos (OK de Augusto 13/10/2026): OP-000004 (Mastroianni / BH Industrial) y OP-000043 (Electronic) estaban
-- anuladas pero la plata salió y sus pagos siguen activos. Se reactivan para que el pago quede atado a la factura
-- y el saldo del proveedor dé 0. Solo sociedad Lazzari. Copia de antes: Claude outputs/antes_op4_op43_13_10_2026.json
-- Vuelta atrás: supabase/rollback/20261013200000_datos_reactivar_op4_op43.sql
begin;

-- OP-000004: los eCheqs 90000169/170 se anularon; pagó por transferencia BBVA el 02/10 ($ 325.500,12).
update public.ordenes_pago
set estado = 'pagada', fecha = '2026-10-02', medio_pago = 'transferencia',
    medios_pago = '[{"tipo":"transferencia","banco":"BBVA","fecha":"2026-10-02","monto":325500.12,"moneda":"ARS","cotizacion":1}]'::jsonb,
    notas = 'Reactivada 13/10/2026: los eCheqs 90000169 y 90000170 se anularon; pagada por transferencia BBVA el 02/10/2026.',
    updated_at = now()
where id = 'd20c121a-1f9e-4b84-8d9c-d31d169482d0' and numero = 'OP-000004' and estado = 'anulada';

update public.movimientos set fecha = '2026-10-02'
where id = '023040ee-4e1c-4a0d-be63-dc995da01311' and orden_pago_id = 'd20c121a-1f9e-4b84-8d9c-d31d169482d0';

-- OP-000043: Electronic está exento de Ganancias. La OP queda por lo transferido el 02/10 ($ 620.329,99) sin retención;
-- los $ 5.870,42 del 08/10 ya están como pago directo de la factura 0004-00011819.
-- Primero se baja el vínculo (si no, el control de saldo de la factura lo rechaza al reactivar).
update public.op_facturas_compra set monto = 620329.99
where id = 'b032eaa5-f6af-47f3-9ca8-4917e8ec426d' and orden_pago_id = '68653961-1135-4528-b9a8-65530927f6de';

update public.ordenes_pago
set estado = 'pagada', monto_bruto = 620329.99, neto_a_pagar = 620329.99,
    retencion_ganancias_monto = 0, retencion_ganancias_pct = 0, base_retencion_ganancias = 0,
    notas = 'Reactivada 13/10/2026: proveedor exento de Ganancias, sin retención. Los $ 5.870,42 retenidos se transfirieron el 08/10/2026 (pago directo de la factura).',
    updated_at = now()
where id = '68653961-1135-4528-b9a8-65530927f6de' and numero = 'OP-000043' and estado = 'anulada';

commit;
