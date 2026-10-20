-- Gastos (Tanda 4, OK de Augusto 20/10/2026): 7 grupos + débito automático como forma de pago.
-- SOLO AGREGA: no borra ni cambia nada de lo que ya hay.
--  1. Columna `grupo` en gastos_manuales y gastos_fijos (Personal, Local y servicios, Profesionales, Impuestos,
--     Bancos y financieros, Operativos, Personales), llenada desde la categoría de hoy. La categoría queda como está
--     (Finanzas vieja la sigue usando). Todo se puede cambiar después desde Finanzas Lazza › Gastos.
--  2. Columna `medio_pago` en gastos_fijos; 'debito_automatico' en los 8 que salen solos de la CC EPP 091-312483/1
--     (luz x2, Flow, seguro Federación Patronal y los 4 planes ARBA; Augusto 18/10).
--  3. Función cargar_debitos_automaticos(sociedad): carga sola, una vez por mes y por fijo, el gasto y su pago de cada
--     débito automático cuyo día ya pasó en el mes en curso (Augusto 18/10: "se dan por pagados solos en su fecha").
--     No carga meses anteriores, ni fijos en US$, ni los que se calculan (SICORE). Si ya hay un gasto de ese fijo en el mes, no hace nada.
-- Correr entera en el SQL Editor de Supabase. Se puede volver a correr.
-- Para deshacer: supabase/rollback/20261020150000_gastos_grupos_debito_automatico.sql

begin;

alter table public.gastos_manuales add column if not exists grupo text;
alter table public.gastos_fijos add column if not exists grupo text;
alter table public.gastos_fijos add column if not exists medio_pago text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'gastos_manuales_grupo_check') then
    alter table public.gastos_manuales add constraint gastos_manuales_grupo_check check (grupo is null or grupo in
      ('Personal', 'Local y servicios', 'Profesionales', 'Impuestos', 'Bancos y financieros', 'Operativos', 'Personales'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'gastos_fijos_grupo_check') then
    alter table public.gastos_fijos add constraint gastos_fijos_grupo_check check (grupo is null or grupo in
      ('Personal', 'Local y servicios', 'Profesionales', 'Impuestos', 'Bancos y financieros', 'Operativos', 'Personales'));
  end if;
end $$;

-- Grupo según la categoría de hoy (misma tabla que lib/gastos-lazza.ts → grupoDeCategoria). Solo donde todavía no tiene.
update public.gastos_manuales set grupo = case categoria
    when 'Sueldos' then 'Personal' when 'Comisiones' then 'Personal'
    when 'Alquiler' then 'Local y servicios' when 'Servicios' then 'Local y servicios' when 'Débitos automáticos' then 'Local y servicios'
    when 'Profesionales' then 'Profesionales'
    when 'Impuestos' then 'Impuestos'
    when 'Financieros' then 'Bancos y financieros' when 'Bancarios' then 'Bancos y financieros'
    when 'Mantenimiento' then 'Operativos' when 'Compras sin factura' then 'Operativos' when 'Importaciones' then 'Operativos'
    when 'Personales' then 'Personales'
    else 'Operativos' end
  where grupo is null;

update public.gastos_fijos set grupo = case categoria
    when 'Sueldos' then 'Personal' when 'Comisiones' then 'Personal'
    when 'Alquiler' then 'Local y servicios' when 'Servicios' then 'Local y servicios' when 'Débitos automáticos' then 'Local y servicios'
    when 'Profesionales' then 'Profesionales'
    when 'Impuestos' then 'Impuestos'
    when 'Financieros' then 'Bancos y financieros' when 'Bancarios' then 'Bancos y financieros'
    when 'Mantenimiento' then 'Operativos' when 'Compras sin factura' then 'Operativos' when 'Importaciones' then 'Operativos'
    when 'Personales' then 'Personales'
    else 'Operativos' end
  where grupo is null;

-- Los 8 débitos automáticos de Lazzari (por id, literal).
update public.gastos_fijos set medio_pago = 'debito_automatico'
  where medio_pago is null
    and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021'
    and id in (
      'c8007589-0dae-47a1-8a4f-7f9fd2f278ea', -- Luz suministro 03A002300320444
      '5aade19b-26dc-4cbe-8d04-bc1e01870a14', -- Luz suministro 03A004300048885
      '6071a0df-d20e-479c-aa47-c7ec4391ca2a', -- Flow
      'e0329e16-da37-4e0d-ab73-02c640febe52', -- Seguro Federación Patronal
      '0e3c5d6f-7af5-4acc-8b3f-1a66e6e88f05', -- ARBA 720201
      'ff8b4dbc-f9c9-41a4-9bf8-45f1175705e9', -- ARBA 780101
      '527daebb-518b-475a-9b4e-4e152867c9e9', -- ARBA 780201
      'edb0efdb-1060-49ec-87fd-e9407f52d31c'  -- ARBA 780301
    );

create or replace function public.cargar_debitos_automaticos(p_sociedad_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
$$;

revoke all on function public.cargar_debitos_automaticos(uuid) from public, anon;
grant execute on function public.cargar_debitos_automaticos(uuid) to authenticated;

commit;
