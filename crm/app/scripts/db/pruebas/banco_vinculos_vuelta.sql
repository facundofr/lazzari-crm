-- Vuelta atrás de 20261030191000_banco_vinculos.sql: líneas, pagos y propuestas vuelven a como estaban
-- (desde lz_backup_banco_vinculos_20261030).

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

select 'vuelta' q, b.tabla, count(*) total,
  count(*) filter (where (case b.tabla when 'extracto_movimientos' then (select to_jsonb(e) from extracto_movimientos e where e.id = b.id)
                                        when 'movimientos' then (select to_jsonb(m) from movimientos m where m.id = b.id)
                                        else (select to_jsonb(p) from finanzas_propuestas p where p.id = b.id) end) = b.fila) identicas
from lz_backup_banco_vinculos_20261030 b group by b.tabla;
