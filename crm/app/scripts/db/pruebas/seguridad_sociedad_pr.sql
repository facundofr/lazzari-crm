-- Prueba de 20261028130000_seguridad_sociedad_pr.sql (SOLO LECTURA). Correr DESPUÉS de la migración.
-- Las 3 filas tienen que dar ok = true.
select 'borrar PR mira la sociedad' as que,
  pg_get_functiondef('public.delete_presupuesto_safe(uuid)'::regprocedure) like '%lz_es_de_sociedad(v_sociedad)%' as ok
union all
select 'cambiar operador mira la sociedad',
  pg_get_functiondef('public.change_pr_operator(uuid,uuid,uuid)'::regprocedure) like '%lz_es_de_sociedad(p_sociedad_id)%'
union all
select 'anónimo sigue sin poder ejecutarlas',
  not has_function_privilege('anon', 'public.delete_presupuesto_safe(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.change_pr_operator(uuid,uuid,uuid)', 'execute');
