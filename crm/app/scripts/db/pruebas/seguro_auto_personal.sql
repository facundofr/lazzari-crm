-- Prueba de 20261030184500_seguro_auto_personal.sql (se corre con --probar: siempre se deshace).
select 'fijo' q, descripcion, grupo, categoria, monto, activo from gastos_fijos where id = 'e0329e16-da37-4e0d-ab73-02c640febe52';
select 'gastos' q, fecha::date, grupo, categoria, monto from gastos_manuales
where id in ('10a439e4-ea57-44b5-8206-bd8155ac137b', '6c59c4e4-c735-4275-8b0e-1662a2dba548') order by fecha;
select 'pagos' q, m.monto, m.conciliado, m.anulado from movimientos m
where m.gasto_manual_id in ('10a439e4-ea57-44b5-8206-bd8155ac137b', '6c59c4e4-c735-4275-8b0e-1662a2dba548') order by m.fecha;
