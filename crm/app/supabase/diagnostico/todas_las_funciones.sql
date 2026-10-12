-- SOLO LECTURA. No cambia nada.
-- Trae en UNA sola fila el código de todas las funciones propias de la base (esquema public, sin las de extensiones)
-- y la lista de triggers, para compararlas con supabase/migrations y encontrar lo que se hizo a mano.
-- En el SQL Editor: Run → Export → Download CSV (el archivo trae el texto completo aunque la pantalla lo corte).
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')) as cantidad_funciones,
  (select string_agg(
      '-- ===== ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' || E'\n' || pg_get_functiondef(p.oid),
      E'\n\n' order by p.proname, p.oid)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')) as funciones,
  (select string_agg(c.relname || ' :: ' || t.tgname || ' :: ' || pg_get_triggerdef(t.oid), E'\n' order by c.relname, t.tgname)
    from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and not t.tgisinternal) as triggers;
