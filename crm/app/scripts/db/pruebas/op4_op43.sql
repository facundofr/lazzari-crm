-- Prueba de 20261013200000_datos_reactivar_op4_op43.sql: saldo de las dos facturas después del cambio (tiene que dar 0).
select f.numero_factura, f.total,
  coalesce((select sum(l.monto) from op_facturas_compra l join ordenes_pago o on o.id = l.orden_pago_id
            where l.factura_compra_id = f.id and o.estado <> 'anulada'), 0) as pagado_op,
  coalesce((select sum(m.monto + coalesce(m.retencion_ganancias_monto, 0)) from movimientos m
            where m.factura_compra_id = f.id and m.tipo = 'pago' and not coalesce(m.anulado, false)), 0) as pagado_directo,
  (select string_agg(o.numero || ' ' || o.estado || ' ret ' || o.retencion_ganancias_monto, ', ') from op_facturas_compra l
     join ordenes_pago o on o.id = l.orden_pago_id where l.factura_compra_id = f.id) as ops
from facturas_compra f
where f.id in ('b70c8ba3-88db-41bf-b335-76e0f61beebc', '3e9b6898-5c8e-4914-b765-9b5c8bfb0d80');
