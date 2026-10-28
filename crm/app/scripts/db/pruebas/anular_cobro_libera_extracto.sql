-- Prueba de 20261028160000: borrar un movimiento conciliado libera su línea del extracto. La corre migrar.cjs --probar y deshace todo.
select set_config('request.jwt.claims', json_build_object('sub', (select id from public.profiles where role::text='super_admin' and coalesce(active,true) limit 1), 'role','authenticated')::text, true);
-- Un movimiento real y una línea real, vinculados a propósito (dentro de la prueba)
update public.extracto_movimientos set estado='matcheado', match_movimiento_id='f62051c1-dd9f-46f8-a337-07fb2d791ceb' where id='6c0e9859-b0ec-4c15-a6fd-e40e63e94a3a';
update public.extractos_bancarios set estado='conciliado' where id='cafa5135-7118-45f6-b11f-98c3b856b62b';
select public.gestionar_cobro('f62051c1-dd9f-46f8-a337-07fb2d791ceb','eliminar') as resultado;
select id, estado, match_movimiento_id from public.extracto_movimientos where id='6c0e9859-b0ec-4c15-a6fd-e40e63e94a3a';
select estado as extracto_estado from public.extractos_bancarios where id='cafa5135-7118-45f6-b11f-98c3b856b62b';
