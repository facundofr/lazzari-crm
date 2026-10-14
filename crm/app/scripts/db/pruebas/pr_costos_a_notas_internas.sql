-- Prueba de 20261014140000_pr_costos_a_notas_internas.sql (se corre con --probar: muestra resultados y DESHACE todo).
select 'respaldados' as control, count(*)::text as valor, 'esperado 14' as nota from public.lz_backup_pr_obs_20261014
union all
select 'PR con renglones automaticos todavia en observaciones', count(*)::text, 'esperado 0'
from public.presupuestos p
where exists (select 1 from regexp_split_to_table(coalesce(p.observaciones, ''), E'\n') t(l) where t.l ~ '^\s*\[\d{1,2}/\d{1,2}/\d{2,4}[\s,\]]')
union all
select 'PR con "(margen" todavia en observaciones', count(*)::text, 'esperado 0'
from public.presupuestos where observaciones ~ '\(margen\s+[\d.,-]+\s*%'
union all
select 'PR-2026-1227: observaciones conserva el texto del vendedor',
       (observaciones like 'INDUMENTARIA: SALDA%')::text, 'esperado true'
from public.presupuestos where numero = 'PR-2026-1227'
union all
select 'PR-2026-1227: notas_internas tiene el ajuste', (notas_internas like '%FC 0002-00036698%margen 43.59%')::text, 'esperado true'
from public.presupuestos where numero = 'PR-2026-1227'
union all
select 'PR-2026-1198: 2 renglones en notas internas',
       (array_length(regexp_split_to_array(notas_internas, E'\n'), 1) >= 2)::text, 'esperado true'
from public.presupuestos where numero = 'PR-2026-1198'
union all
select 'guardar_conciliacion_compra ya no escribe observaciones del PR',
       (pg_get_functiondef('public.guardar_conciliacion_compra(uuid,uuid,jsonb,jsonb,jsonb,boolean,boolean,jsonb,boolean)'::regprocedure) !~* 'update public\.presupuestos set observaciones')::text, 'esperado true'
union all
select 'guardar_conciliacion_compra escribe notas_internas',
       (pg_get_functiondef('public.guardar_conciliacion_compra(uuid,uuid,jsonb,jsonb,jsonb,boolean,boolean,jsonb,boolean)'::regprocedure) ~* 'update public\.presupuestos set notas_internas')::text, 'esperado true'
union all
select 'ajustar_oc_a_factura escribe notas_internas del PR',
       (pg_get_functiondef('public.ajustar_oc_a_factura(uuid,uuid)'::regprocedure) ~* 'update presupuestos\s+set notas_internas')::text, 'esperado true'
union all
select 'ajustar_oc_a_factura sigue anotando la OC en observaciones',
       (pg_get_functiondef('public.ajustar_oc_a_factura(uuid,uuid)'::regprocedure) ~* 'update ordenes_compra\s+set observaciones|set observaciones = coalesce\(observaciones')::text, 'esperado true'
union all
select 'la tabla de respaldo no es visible para el rol anonimo',
       (not has_table_privilege('anon', 'public.lz_backup_pr_obs_20261014', 'select'))::text, 'esperado true';
