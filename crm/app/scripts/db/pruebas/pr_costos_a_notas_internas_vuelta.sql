-- Prueba de la vuelta atrás: se corre junto con la migración (archivo temporal que concatena migración + rollback) y debe dejar todo como estaba.
select 'PR con renglones automaticos en observaciones (vuelven)' as control, count(*)::text as valor, 'esperado 14' as nota
from public.presupuestos p
where exists (select 1 from regexp_split_to_table(coalesce(p.observaciones, ''), E'\n') t(l) where t.l ~ '^\s*\[\d{1,2}/\d{1,2}/\d{2,4}[\s,\]]')
union all
select 'guardar_conciliacion_compra vuelve a escribir observaciones del PR',
       (pg_get_functiondef('public.guardar_conciliacion_compra(uuid,uuid,jsonb,jsonb,jsonb,boolean,boolean,jsonb,boolean)'::regprocedure) ~* 'update public\.presupuestos set observaciones')::text, 'esperado true'
union all
select 'ajustar_oc_a_factura vuelve a escribir observaciones del PR',
       (pg_get_functiondef('public.ajustar_oc_a_factura(uuid,uuid)'::regprocedure) ~* 'update presupuestos\s+set observaciones')::text, 'esperado true';
