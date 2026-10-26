-- Después de la migración: el ajuste queda atado a la FA 68 y la FA 68 debe 1.836.717,86.
select m.id, m.factura_id, m.monto, m.anulado, m.descripcion from public.movimientos m where m.id = 'ff39ab9f-80fa-4eed-be82-044c3564b527';
select f.numero, f.total,
       f.total - coalesce(f.total_acreditado, 0)
         - coalesce((select sum(monto) from public.movimientos where factura_id = f.id and not coalesce(anulado, false)
                     and id not in (select movimiento_id from public.cobro_aplicaciones)), 0)
         - coalesce((select sum(ca.monto) from public.cobro_aplicaciones ca join public.movimientos mm on mm.id = ca.movimiento_id
                     where ca.factura_id = f.id and not coalesce(mm.anulado, false)), 0) as saldo
  from public.facturas f where f.id = '3764921f-2884-4ca3-8754-7ea28f66865a';
