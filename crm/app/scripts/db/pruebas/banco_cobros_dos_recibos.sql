-- Prueba de 20261030191500_banco_cobros_dos_recibos.sql (con --probar: siempre se deshace), con la vuelta atrás al final.
select 'despues' q, e.fecha::date, e.monto, (select count(*) from movimientos m where m.extracto_movimiento_id = e.id) cobros,
  (select sum(m.monto) from movimientos m where m.extracto_movimiento_id = e.id) suma
from extracto_movimientos e where e.id in ('9c4b1242-85e8-42ba-b74a-aed24adfeaca','a63ba901-0a3b-47b1-b37b-925408d21f41','e4ec6651-8dd8-4d5b-8e18-eaddfb29d220','f039873f-1581-41cb-a99e-e3ddbb44e4fc','4ff1671a-d2d5-40cf-a6aa-805eef545fd3') order by e.fecha;
-- Vuelta atrás de 20261030191500_banco_cobros_dos_recibos.sql: los cobros vuelven a como estaban (desde el respaldo).

update public.movimientos m
   set extracto_movimiento_id = r.extracto_movimiento_id, conciliado = r.conciliado,
       conciliado_at = r.conciliado_at, conciliado_por = r.conciliado_por
  from public.lz_backup_banco_dos_recibos_20261030 b, jsonb_populate_record(null::public.movimientos, b.fila) r
 where m.id = r.id;

select 'vuelta' q, count(*) total, count(*) filter (where (select to_jsonb(m) from movimientos m where m.id = b.id) = b.fila) identicos from lz_backup_banco_dos_recibos_20261030 b;
