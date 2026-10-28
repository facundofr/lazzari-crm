-- 28/10/2026 (Augusto): la FC de Inga 00002-00000140 (US$ 550, septiembre) figuraba pagada sin pago registrado. Se pagó por transferencia;
-- no importa la fecha: se pone la de la factura (08/09/2026), por el total. Aditivo: un solo movimiento.
-- Vuelta atrás: supabase/rollback/20261028180000_inga_fc140_pago.sql
begin;

insert into public.movimientos (tipo, descripcion, monto, moneda, fecha, conciliado, sociedad_id, proveedor_id, factura_compra_id)
select 'pago',
  'Pago — INGA NATALIA — FC 00002-00000140 — transferencia (fecha de la factura; según Augusto 28/10/2026)',
  550, 'USD', date '2026-09-08', false, f.sociedad_id, f.proveedor_id, f.id
from public.facturas_compra f
where f.id = '89a24301-74b1-4ffe-b64c-383b94dc7bc7'
  and not exists (select 1 from public.movimientos m where m.factura_compra_id = f.id and not coalesce(m.anulado, false));

commit;
