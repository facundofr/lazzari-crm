-- Vuelta atrás de 20261030193200_truck_roque_banelco.sql: la línea del 26/10 y el cobro de Truck Roque vuelven a como estaban.
begin;

update public.extracto_movimientos e
   set estado = r.estado, clasificacion = r.clasificacion, subtipo = r.subtipo, match_movimiento_id = r.match_movimiento_id,
       match_cliente_id = r.match_cliente_id, match_proveedor_id = r.match_proveedor_id, match_factura_id = r.match_factura_id,
       nota = r.nota, clasificado_por = r.clasificado_por, clasificado_at = r.clasificado_at
  from public.lz_backup_truck_roque_20261030 b, jsonb_populate_record(null::public.extracto_movimientos, b.fila) r
 where b.que = 'linea' and e.id = r.id;

update public.movimientos m
   set extracto_movimiento_id = r.extracto_movimiento_id, conciliado = r.conciliado, conciliado_at = r.conciliado_at,
       conciliado_por = r.conciliado_por, cuenta_id = r.cuenta_id
  from public.lz_backup_truck_roque_20261030 b, jsonb_populate_record(null::public.movimientos, b.fila) r
 where b.que = 'cobro' and m.id = r.id;

commit;
