-- `ordenes_pago.medios_pago` es jsonb. Dos RPC convertían el payload a text,
-- por lo que PostgreSQL abortaba toda la transacción antes de crear la OP.
-- Reescribimos únicamente ese cast en las funciones ya instaladas.
do $migration$
declare
  v_function record;
  v_definition text;
begin
  for v_function in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('registrar_pago_proveedor_seguro', 'liquidar_documentos_fx')
  loop
    v_definition := pg_get_functiondef(v_function.oid);
    if strpos(v_definition, 'p_medios::text') > 0 then
      execute replace(v_definition, 'p_medios::text', 'p_medios');
    end if;
  end loop;

  if (
    select count(distinct p.proname)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('registrar_pago_proveedor_seguro', 'liquidar_documentos_fx')
  ) <> 2 then
    raise exception 'No se encontraron las dos funciones de pago esperadas';
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('registrar_pago_proveedor_seguro', 'liquidar_documentos_fx')
      and strpos(pg_get_functiondef(p.oid), 'p_medios::text') > 0
  ) then
    raise exception 'No se pudo corregir el cast de medios_pago a jsonb';
  end if;
end
$migration$;
