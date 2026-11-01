-- Prueba de 20261030193200_truck_roque_banelco.sql (con --probar: siempre se deshace), con la vuelta atrás al final.
select 'linea' q, estado, clasificacion, match_movimiento_id is not null atada, left(nota, 50) nota from extracto_movimientos where id = '8e9e492e-7e94-4027-942c-8c48d10148eb';
select 'cobro' q, m.conciliado, c.nombre cuenta, m.extracto_movimiento_id is not null dos_lados from movimientos m left join cuentas_financieras c on c.id = m.cuenta_id where m.id = 'bfd96e28-4a72-4f1c-a723-e338daac4ca9';
-- Vuelta atrás de 20261030193200_truck_roque_banelco.sql: la línea del 26/10 y el cobro de Truck Roque vuelven a como estaban.

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

select 'vuelta' q, b.que, (case b.que when 'linea' then (select to_jsonb(e) from extracto_movimientos e where e.id = (b.fila->>'id')::uuid) else (select to_jsonb(m) from movimientos m where m.id = (b.fila->>'id')::uuid) end) = b.fila identica from lz_backup_truck_roque_20261030 b;
