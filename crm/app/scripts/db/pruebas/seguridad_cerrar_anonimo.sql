-- Prueba de 20261028120000_seguridad_cerrar_anonimo.sql (SOLO LECTURA). Correr DESPUÉS de la migración.
-- Todas las columnas "ok" tienen que dar true. Si alguna da false, avisar antes de seguir.
select 'cotizacion: anon no escribe' as que,
  not has_table_privilege('anon', 'public.cotizaciones_dolar', 'insert')
  and not has_table_privilege('anon', 'public.cotizaciones_dolar', 'update')
  and not exists (select 1 from pg_policies where tablename = 'cotizaciones_dolar' and 'anon' = any(roles) and cmd <> 'SELECT') as ok
union all
select 'cotizacion: logueados siguen leyendo',
  has_table_privilege('authenticated', 'public.cotizaciones_dolar', 'select')
union all
select 'vistas: anon no lee ninguna',
  not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v' and has_table_privilege('anon', c.oid, 'select'))
union all
select 'vistas: todas con security_invoker',
  not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v' and not coalesce(c.reloptions::text like '%security_invoker=true%', false))
union all
select 'funciones: anon no ejecuta las 14',
  not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('aprender_equivalencias','cerrar_saldo_oc','change_pr_operator',
      'check_listas_vencidas','check_presupuestos_vencidos','delete_manual_invoice','delete_presupuesto_safe',
      'generar_recordatorios_eventos','get_balance_projection','get_dashboard_kpis','increment_stock',
      'nc_compra_disponible','normalizar_items_oc') and has_function_privilege('anon', p.oid, 'execute'))
union all
select 'funciones: logueados siguen ejecutando las 14',
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('aprender_equivalencias','cerrar_saldo_oc','change_pr_operator',
      'check_listas_vencidas','check_presupuestos_vencidos','delete_manual_invoice','delete_presupuesto_safe',
      'generar_recordatorios_eventos','get_balance_projection','get_dashboard_kpis','increment_stock',
      'nc_compra_disponible','normalizar_items_oc') and has_function_privilege('authenticated', p.oid, 'execute')) = 14
union all
select 'archivos: sin permisos para anon/public',
  not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
    and (roles && array['anon','public']::name[]))
union all
select 'archivos: logueados siguen leyendo y subiendo facturas-compra y comprobantes',
  (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and 'authenticated' = any(roles)
    and policyname in ('Authenticated users can read comprobantes', 'Authenticated users can upload comprobantes',
      'Authenticated users can read facturas-compra', 'Authenticated users can upload facturas-compra',
      'Authenticated users can update facturas-compra')) = 5;
