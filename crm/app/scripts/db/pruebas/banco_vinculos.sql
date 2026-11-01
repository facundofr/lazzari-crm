-- Prueba de 20261030191000_banco_vinculos.sql (con --probar: siempre se deshace).
select 'lineas' q, e.fecha::date, e.monto, e.estado, (select count(*) from movimientos m where m.extracto_movimiento_id = e.id) pagos,
  (select sum(m.monto) from movimientos m where m.extracto_movimiento_id = e.id) suma
from extracto_movimientos e where e.id in ('6c0e9859-b0ec-4c15-a6fd-e40e63e94a3a', '1a22e8f6-3a75-4d60-8936-9ca31046a71e',
  '3eff963e-9084-4788-aba4-f373a91e7d1f', '020d8e52-52c1-4850-bcf2-716b7cb59832') order by e.fecha, e.monto;
select 'un_lado' q, count(*) filter (where m.extracto_movimiento_id is distinct from e.id) sin_vuelta
from extracto_movimientos e join movimientos m on m.id = e.match_movimiento_id;
select 'propuestas' q, estado, count(*) from finanzas_propuestas group by estado;
select 'respaldo' q, tabla, count(*) from lz_backup_banco_vinculos_20261030 group by tabla;
