-- Vuelta atrás de 20261030191000_banco_vinculos.sql: líneas, pagos y propuestas vuelven a como estaban
-- (desde lz_backup_banco_vinculos_20261030).
begin;

update public.extracto_movimientos e
   set estado = r.estado, match_movimiento_id = r.match_movimiento_id, clasificado_at = r.clasificado_at, nota = r.nota
  from public.lz_backup_banco_vinculos_20261030 b, jsonb_populate_record(null::public.extracto_movimientos, b.fila) r
 where b.tabla = 'extracto_movimientos' and e.id = r.id;

update public.movimientos m
   set extracto_movimiento_id = r.extracto_movimiento_id, conciliado = r.conciliado,
       conciliado_at = r.conciliado_at, conciliado_por = r.conciliado_por
  from public.lz_backup_banco_vinculos_20261030 b, jsonb_populate_record(null::public.movimientos, b.fila) r
 where b.tabla = 'movimientos' and m.id = r.id;

update public.finanzas_propuestas p
   set estado = r.estado, motivo = r.motivo, resuelto_at = r.resuelto_at, resuelto_por = r.resuelto_por
  from public.lz_backup_banco_vinculos_20261030 b, jsonb_populate_record(null::public.finanzas_propuestas, b.fila) r
 where b.tabla = 'finanzas_propuestas' and p.id = r.id;

commit;
