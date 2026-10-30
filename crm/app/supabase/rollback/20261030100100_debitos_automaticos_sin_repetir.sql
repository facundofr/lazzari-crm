-- Vuelta atrás de 20261030100100_debitos_automaticos_sin_repetir: cargar_debitos_automaticos como estaba antes (copiada de la base el 30/10/2026).
begin;

CREATE OR REPLACE FUNCTION public.cargar_debitos_automaticos(p_sociedad_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_ultimo integer := extract(day from (date_trunc('month', v_hoy) + interval '1 month - 1 day'))::integer;
  v_meses text[] := array['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  v_fecha date;
  v_desc text;
  v_gasto uuid;
  v_out jsonb := '[]'::jsonb;
  f record;
begin
  if auth.uid() is null
    or not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('super_admin', 'admin', 'administrativo'))
    or (
      exists (select 1 from public.user_sociedades us where us.user_id = auth.uid())
      and not exists (select 1 from public.user_sociedades us where us.user_id = auth.uid() and us.sociedad_id = p_sociedad_id)
    )
  then
    raise exception 'No tenés permiso para cargar gastos en esta sociedad';
  end if;

  -- Una sola carga a la vez por sociedad (si dos abren la pantalla juntos, no se duplica).
  perform pg_advisory_xact_lock(hashtext('cargar_debitos_automaticos:' || p_sociedad_id::text));

  for f in
    select * from public.gastos_fijos
    where sociedad_id = p_sociedad_id and activo and medio_pago = 'debito_automatico'
      and dia_vencimiento is not null and coalesce(calculo, '') = '' and moneda = 'ARS' and coalesce(monto, 0) > 0
    order by dia_vencimiento, descripcion
  loop
    v_fecha := make_date(extract(year from v_hoy)::integer, extract(month from v_hoy)::integer, least(f.dia_vencimiento::integer, v_ultimo));
    continue when v_fecha > v_hoy;
    continue when exists (
      select 1 from public.gastos_manuales g
      where g.gasto_fijo_id = f.id and g.sociedad_id = p_sociedad_id
        and extract(year from g.fecha) = extract(year from v_fecha) and extract(month from g.fecha) = extract(month from v_fecha)
    );
    v_desc := f.descripcion || ' — ' || v_meses[extract(month from v_fecha)::integer] || ' ' || extract(year from v_fecha)::integer;
    insert into public.gastos_manuales (sociedad_id, fecha, descripcion, proveedor_id, categoria, grupo, monto, moneda, notas, created_by,
      tipo_gasto, tipo_recurrencia, medio_pago, gasto_fijo_id)
    values (p_sociedad_id, v_fecha, v_desc, f.proveedor_id, coalesce(f.categoria, 'Varios'), f.grupo, f.monto, 'ARS',
      '[débito automático cargado solo]', auth.uid(), 'general', 'mensual', 'debito_automatico', f.id)
    returning id into v_gasto;
    insert into public.movimientos (tipo, descripcion, monto, moneda, fecha, conciliado, gasto_manual_id, proveedor_id, sociedad_id, created_by)
    values ('pago', 'Gasto — ' || coalesce(f.categoria, 'Varios') || ' — ' || v_desc, f.monto, 'ARS', v_fecha, false, v_gasto, f.proveedor_id, p_sociedad_id, auth.uid());
    v_out := v_out || jsonb_build_object('gasto_id', v_gasto, 'descripcion', v_desc, 'monto', f.monto, 'fecha', v_fecha);
  end loop;
  return v_out;
end;
$function$;

commit;
