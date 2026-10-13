-- Prueba de 20261013100000_permisos_por_rol.sql (se corre con --probar: al final se deshace TODO).
-- Simula a Jerónimo (vendedor) y a Mariana (admin y después administrativa) y anota qué pudo hacer cada uno.
create temp table pr_res (n serial, quien text, prueba text, esperado text, resultado text);
grant all on pr_res to public;
grant all on sequence pr_res_n_seq to public;

create or replace function pg_temp.pr_upd(p_quien text, p_tabla text, p_esperado text) returns void language plpgsql as $$
declare v_n int; v_vis int;
begin
  execute format('select count(*) from public.%I', p_tabla) into v_vis;
  execute format('update public.%I set id = id where id = (select id from public.%I limit 1)', p_tabla, p_tabla);
  get diagnostics v_n = row_count;
  insert into pr_res (quien, prueba, esperado, resultado)
  values (p_quien, 'cambiar ' || p_tabla, p_esperado, case when v_vis = 0 then 'tabla vacía' when v_n > 0 then 'pudo' else 'NO pudo' end);
exception when others then
  insert into pr_res (quien, prueba, esperado, resultado) values (p_quien, 'cambiar ' || p_tabla, p_esperado, 'error: ' || sqlerrm);
end $$;

create or replace function pg_temp.pr_rpc(p_quien text, p_prueba text, p_sql text, p_esperado text) returns void language plpgsql as $$
declare v jsonb;
begin
  execute p_sql into v;
  insert into pr_res (quien, prueba, esperado, resultado) values (p_quien, p_prueba, p_esperado, coalesce(v->>'accion', v::text));
exception when others then
  insert into pr_res (quien, prueba, esperado, resultado) values (p_quien, p_prueba, p_esperado, 'error: ' || sqlerrm);
end $$;

-- ── Jerónimo (vendedor) ───────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"41989f6c-4cb0-487a-aa2a-2290a462949f","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.pr_upd('vendedor', 'ordenes_pago', 'NO pudo');
select pg_temp.pr_upd('vendedor', 'echeqs', 'NO pudo');
select pg_temp.pr_upd('vendedor', 'saldos_caja', 'NO pudo');
select pg_temp.pr_upd('vendedor', 'gastos_manuales', 'NO pudo');
select pg_temp.pr_upd('vendedor', 'cobro_aplicaciones', 'NO pudo');
select pg_temp.pr_upd('vendedor', 'retencion_config', 'NO pudo');
select pg_temp.pr_upd('vendedor', 'email_templates', 'NO pudo');
select pg_temp.pr_upd('vendedor', 'ordenes_compra', 'pudo');
select pg_temp.pr_upd('vendedor', 'facturas_compra', 'pudo');
select pg_temp.pr_upd('vendedor', 'proveedores', 'pudo');
select pg_temp.pr_upd('vendedor', 'clientes', 'pudo');
select pg_temp.pr_upd('vendedor', 'transportes', 'pudo');
select pg_temp.pr_upd('vendedor', 'muestra_envios', 'pudo');
select pg_temp.pr_upd('vendedor', 'personalizacion_trabajos', 'pudo');
insert into pr_res (quien, prueba, esperado, resultado)
select 'vendedor', 'ver órdenes de pago', 've', case when count(*) > 0 then 've (' || count(*) || ')' else 'no ve' end from public.ordenes_pago;
select pg_temp.pr_rpc('vendedor', 'eliminar cliente sin motivo', $q$select public.eliminar_cliente('040ea9ed-4231-49cf-a0e2-d207baa30ae1', '  ')$q$, 'error: pide motivo');
select pg_temp.pr_rpc('vendedor', 'eliminar cliente SIN historial (TOTAL MEDIC)', $q$select public.eliminar_cliente('040ea9ed-4231-49cf-a0e2-d207baa30ae1', 'Prueba: cargado dos veces')$q$, 'eliminado');
select pg_temp.pr_rpc('vendedor', 'eliminar cliente CON facturas (LIMAGRAIN)', $q$select public.eliminar_cliente('02d84920-ac9c-4203-aaaf-a498c7f87d8c', 'Prueba: ya no compra')$q$, 'desactivado');
select pg_temp.pr_rpc('vendedor', 'eliminar proveedor CON OC (BIOMED)', $q$select public.eliminar_proveedor('07950ef3-0e57-416a-8d07-764dd56d3259', 'Prueba: no trabajamos más')$q$, 'desactivado');
insert into pr_res (quien, prueba, esperado, resultado)
select 'vendedor', 'ver lo que él eliminó', '3', count(*)::text from public.registros_eliminados;
insert into pr_res (quien, prueba, esperado, resultado)
select 'vendedor', 'ver facturas de venta y de compra', 've', 've (' || (select count(*) from public.facturas) || ' venta, ' || (select count(*) from public.facturas_compra) || ' compra)';
select pg_temp.pr_upd('vendedor', 'facturas', 'NO pudo');
select pg_temp.pr_rpc('vendedor', 'marcar factura de venta como enviada', $q$select jsonb_build_object('accion', (select 'ok' from (select public.marcar_factura_enviada((select id from public.facturas where sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' order by fecha desc limit 1), 'prueba@ejemplo.com', null)) x))$q$, 'ok');
insert into pr_res (quien, prueba, esperado, resultado)
select 'vendedor', 'quedó la marca de envío', 'prueba@ejemplo.com', email_enviado_a from public.facturas where sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' order by fecha desc limit 1;
reset role;

-- ── Mariana hoy (admin) ───────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"77f09508-eb3b-4779-83b5-1c7347003d88","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.pr_upd('Mariana admin', 'ordenes_pago', 'pudo');
select pg_temp.pr_upd('Mariana admin', 'echeqs', 'pudo');
reset role;

-- ── Mariana administrativa ────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"cb8fdf3e-d171-4042-9da7-248fe863b96d","role":"authenticated"}', true);
update public.profiles set role = 'administrativo' where id = '77f09508-eb3b-4779-83b5-1c7347003d88';
select set_config('request.jwt.claims', '{"sub":"77f09508-eb3b-4779-83b5-1c7347003d88","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.pr_upd('Mariana administrativa', 'ordenes_pago', 'pudo');
select pg_temp.pr_upd('Mariana administrativa', 'echeqs', 'pudo');
select pg_temp.pr_upd('Mariana administrativa', 'gastos_manuales', 'pudo');
select pg_temp.pr_upd('Mariana administrativa', 'saldos_caja', 'pudo');
select pg_temp.pr_upd('Mariana administrativa', 'retencion_config', 'pudo');
select pg_temp.pr_upd('Mariana administrativa', 'email_templates', 'pudo');
select pg_temp.pr_upd('Mariana administrativa', 'gastos_fijos', 'pudo');
select pg_temp.pr_upd('Mariana administrativa', 'configuracion', 'pudo');
select pg_temp.pr_upd('Mariana administrativa', 'muestra_envios', 'pudo');
select pg_temp.pr_upd('Mariana administrativa', 'extractos_bancarios', 'pudo');
select pg_temp.pr_upd('Mariana administrativa', 'comision_reglas', 'NO pudo');
select pg_temp.pr_upd('Mariana administrativa', 'objetivos', 'NO pudo');
insert into pr_res (quien, prueba, esperado, resultado)
select 'Mariana administrativa', 'ver eliminados (de todos)', '3', count(*)::text from public.registros_eliminados;
reset role;

select quien, prueba, esperado, resultado,
  case when resultado = esperado or (esperado like 'error%' and resultado like 'error%') or (esperado = 've' and resultado like 've%') or resultado = 'tabla vacía' then 'OK' else '⚠️ REVISAR' end as ok
from pr_res order by n;
