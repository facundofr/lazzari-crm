-- Prueba de 20261028200000_presupuesto_envios.sql (solo lectura). Las 4 filas tienen que dar ok = true.
select 'tabla creada' as prueba, to_regclass('public.presupuesto_envios') is not null as ok
union all
select 'RLS activa', (select relrowsecurity from pg_class where oid = 'public.presupuesto_envios'::regclass)
union all
select 'anon sin permiso', not has_table_privilege('anon', 'public.presupuesto_envios', 'select')
union all
select 'usuarios leen y anotan, no borran', has_table_privilege('authenticated', 'public.presupuesto_envios', 'insert')
  and not has_table_privilege('authenticated', 'public.presupuesto_envios', 'delete');
