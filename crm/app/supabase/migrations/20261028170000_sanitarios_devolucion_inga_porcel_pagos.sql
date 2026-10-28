-- 28/10/2026 (Augusto). Aditivo: solo agrega 3 movimientos. Vuelta atrás: supabase/rollback/20261028170000_sanitarios_devolucion_inga_porcel_pagos.sql
-- 1) Sanitarios San Martín (Lazzari): se le pagó de más en la OP-000047 (FC 0007-00024709: la OP aplicó 1.023.677,92 y la factura quedó en 804.129,86)
--    y ya devolvió todo. Ajuste manual a favor del proveedor por la diferencia: la cuenta queda en 0.
-- 2) Inga y Porcel (Grupo LA, octubre): el pago real que faltaba. Un movimiento de pago atado al gasto manual del mes (es el mismo pago)
--    y a su factura de compra (así la base la ve pagada). Sin cuenta bancaria, igual que los demás gastos.
begin;

insert into public.movimientos (tipo, ajuste_sentido, descripcion, monto, moneda, fecha, conciliado, sociedad_id, proveedor_id)
select 'ajuste', 'credito',
  '[Ajuste manual] Devolución de Sanitarios San Martín: se le pagó de más en la OP-000047 (FC 0007-00024709) y lo devolvió todo. Cuenta en 0.',
  round(1023677.92 - 804129.86, 2), 'ARS', date '2026-10-28', false, f.sociedad_id, f.proveedor_id
from public.facturas_compra f
where f.id = 'e0a092d0-e059-4719-acce-378837265e9e'
  and not exists (select 1 from public.movimientos m where m.proveedor_id = f.proveedor_id and m.descripcion like '[Ajuste manual] Devolución de Sanitarios San Martín%');

insert into public.movimientos (tipo, descripcion, monto, moneda, fecha, conciliado, sociedad_id, proveedor_id, factura_compra_id, gasto_manual_id)
select 'pago',
  'Pago — INGA NATALIA — FC 00002-00000145 — transferencia Galicia CC 78656613 del 09/10/2026 ($ 1.705.000 por US$ 1.100, TC 1.550). Es el mismo pago del gasto de octubre.',
  1100, 'USD', date '2026-10-09', false, f.sociedad_id, f.proveedor_id, f.id, '48d20099-a38b-49ed-abdb-c9b87bee4fa5'::uuid
from public.facturas_compra f
where f.id = '17af302e-e8cc-419c-9b5e-e929ae7ea855'
  and not exists (select 1 from public.movimientos m where m.gasto_manual_id = '48d20099-a38b-49ed-abdb-c9b87bee4fa5');

insert into public.movimientos (tipo, descripcion, monto, moneda, fecha, conciliado, sociedad_id, proveedor_id, factura_compra_id, gasto_manual_id)
select 'pago',
  'Pago — PORCEL LEANDRO — FC 0001-00000415 — transferencia Galicia CC 78656613 del 09/10/2026 ($ 500.000). Es el mismo pago del gasto de octubre.',
  500000, 'ARS', date '2026-10-09', false, f.sociedad_id, f.proveedor_id, f.id, 'd41a42d0-c434-451d-aac8-c871cd77d00e'::uuid
from public.facturas_compra f
where f.id = 'e63474af-c910-4b2e-a7c0-a8024edf0e53'
  and not exists (select 1 from public.movimientos m where m.gasto_manual_id = 'd41a42d0-c434-451d-aac8-c871cd77d00e');

commit;
