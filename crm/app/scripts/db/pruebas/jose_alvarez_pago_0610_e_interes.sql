select g.grupo, g.categoria, g.descripcion, g.monto, g.gasto_fijo_id is not null del_fijo, (select count(*) from movimientos m where m.gasto_manual_id = g.id) pagos
from gastos_manuales g where g.notas like '%[jose-0610]' order by g.monto desc;
select 'fijo' t, descripcion, monto, grupo from gastos_fijos where id = '6a1f0c10-0001-4e00-9a00-0000000000a1';
select 'linea' t, estado::text, left(nota, 60) nota from extracto_movimientos where id = '6c0e9859-b0ec-4c15-a6fd-e40e63e94a3a'
