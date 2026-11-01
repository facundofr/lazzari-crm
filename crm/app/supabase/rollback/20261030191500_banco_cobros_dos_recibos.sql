-- Vuelta atrás de 20261030191500_banco_cobros_dos_recibos.sql: los cobros vuelven a como estaban (desde el respaldo).
begin;

update public.movimientos m
   set extracto_movimiento_id = r.extracto_movimiento_id, conciliado = r.conciliado,
       conciliado_at = r.conciliado_at, conciliado_por = r.conciliado_por
  from public.lz_backup_banco_dos_recibos_20261030 b, jsonb_populate_record(null::public.movimientos, b.fila) r
 where m.id = r.id;

commit;
