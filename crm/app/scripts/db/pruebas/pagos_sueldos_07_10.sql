select g.grupo, g.categoria, g.descripcion, g.monto, (select count(*) from movimientos m where m.gasto_manual_id=g.id) pagos from gastos_manuales g where g.notas like '%[sueldos-07/10]' order by 3;
select g.grupo, sum(g.monto) total from gastos_manuales g where g.notas like '%[sueldos-07/10]' group by 1
