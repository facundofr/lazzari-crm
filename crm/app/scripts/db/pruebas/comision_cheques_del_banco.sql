-- Prueba de 20261030190000_comision_cheques_del_banco.sql (con --probar: siempre se deshace).
select 'gasto_existe' q, count(*) n from gastos_manuales where id = 'c19763c3-e20f-4e09-986f-dc283a2a3a4c';
select 'pago' q, monto, anulado, conciliado, gasto_manual_id, extracto_movimiento_id from movimientos where id = '846e2040-6a8d-4a46-af30-e3442062ab0c';
select 'lineas' q, monto, estado, clasificacion, subtipo, match_movimiento_id, left(nota, 60) nota from extracto_movimientos
 where id in ('9ceccf09-1f23-40b1-8e58-373ce5ab1658', '02e41065-3d24-48cd-b58a-773b1dda9c1c');
select 'respaldo' q, que, (select relrowsecurity from pg_class where relname = 'lz_backup_comision_cheques_20261030') rls from lz_backup_comision_cheques_20261030 order by que;
