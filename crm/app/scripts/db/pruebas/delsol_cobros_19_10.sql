-- Prueba (siempre con rollback) de los cobros de Del Sol del 19/10: movimientos nuevos, su recibo, eCheq atado y textos.
select m.fecha::text, m.tipo, m.monto, m.cuenta_id, r.numero recibo, left(m.descripcion, 90) descr
  from public.movimientos m
  left join public.recibo_movimientos rm on rm.movimiento_id = m.id
  left join public.recibos r on r.id = rm.recibo_id
 where m.cliente_id = '0f389afe-b826-427e-93fd-ff27bd24f78a'
 order by m.fecha, m.tipo;
select numero, movimiento_id, left(observaciones, 60) obs from public.echeqs where numero in ('00003587', '3644');
