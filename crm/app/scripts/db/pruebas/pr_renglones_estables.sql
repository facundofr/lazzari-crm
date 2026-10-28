-- Prueba de 20261028170000_pr_renglones_estables.sql (SOLO LECTURA). Las 3 filas tienen que dar ok = true.
select 'editar PR actualiza renglones en su lugar (no borra todos)' as que,
  pg_get_functiondef('public.actualizar_presupuesto_atomico'::regproc) like '%v_renglones%'
  and pg_get_functiondef('public.actualizar_presupuesto_atomico'::regproc) not like '%delete from public.presupuesto_items
  where presupuesto_id = p_presupuesto_id;%' as ok
union all
select 'editar y crear guardan precio de lista y descuento',
  pg_get_functiondef('public.actualizar_presupuesto_atomico'::regproc) like '%descuento_general_porcentaje%'
  and pg_get_functiondef('public.crear_presupuesto_atomico'::regproc) like '%precio_lista, descuento_porcentaje%'
union all
select 'los usuarios logueados siguen pudiendo usarlas',
  has_function_privilege('authenticated', 'public.actualizar_presupuesto_atomico(uuid,uuid,jsonb,jsonb)', 'execute')
  and has_function_privilege('authenticated', 'public.crear_presupuesto_atomico(uuid,jsonb,jsonb)', 'execute');
