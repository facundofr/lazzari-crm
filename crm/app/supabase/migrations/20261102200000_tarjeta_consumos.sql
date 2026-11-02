-- Visa consumo por consumo (Augusto 02/11/2026: "en la misma pestaña de Mercado Libre, que estén detallados los consumos y que los
-- chicos puedan ver si falta alguna factura a ese consumo y la puedan agregar").
-- Al subir el resumen de la tarjeta (Finanzas → Bancos → Tarjetas) se guardan sus consumos y los cargos del banco, renglón por renglón.
-- Cada comercio se clasifica una vez (compra / servicio / personal); los chicos ven solo los consumos de compras (Compras → Mercado Libre).
-- El cruce con lo cargado en el CRM se calcula en pantalla (lib/visa-cruce) y NO se guarda: acá queda solo lo que hace una persona
-- (la factura que eligió o cargó para el consumo, o «No tiene factura» con el motivo).
-- Solo AGREGA 2 tablas y 4 funciones: no cambia ni borra nada de lo que ya existe (resúmenes, movimientos, facturas, pagos).
-- Vuelta atrás: supabase/rollback/20261102200000_tarjeta_consumos.sql · Prueba: scripts/db/pruebas/tarjeta_consumos.sql
begin;

create table if not exists public.tarjeta_consumos (
  id uuid primary key default gen_random_uuid(),
  sociedad_id uuid not null references public.sociedades(id) on delete restrict,
  cuenta_id uuid not null references public.cuentas_financieras(id) on delete restrict,
  resumen_id uuid not null references public.tarjeta_resumenes(id) on delete restrict,
  fecha date not null,
  descripcion text not null,
  comercio text not null,
  cupon text,
  cuota_n integer,
  cuota_de integer,
  importe numeric(16,2) not null,
  moneda text not null check (moneda in ('ARS', 'USD')),
  tipo text not null default 'consumo' check (tipo in ('consumo', 'cargo')),
  clase text check (clase in ('compra', 'servicio', 'personal')),
  clase_manual boolean not null default false,
  factura_compra_id uuid references public.facturas_compra(id) on delete set null,
  sin_factura_motivo text,
  marcado_por uuid references auth.users(id),
  marcado_at timestamptz,
  clave text not null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users(id),
  unique (resumen_id, clave)
);
create index if not exists tarjeta_consumos_resumen_idx on public.tarjeta_consumos (resumen_id, fecha);
create index if not exists tarjeta_consumos_comercio_idx on public.tarjeta_consumos (sociedad_id, comercio);

create table if not exists public.tarjeta_comercios (
  sociedad_id uuid not null references public.sociedades(id) on delete restrict,
  comercio text not null,
  clase text check (clase in ('compra', 'servicio', 'personal')),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users(id),
  primary key (sociedad_id, comercio)
);

-- Se leen directo solo desde Finanzas; los chicos leen por consumos_de_tarjeta (solo compras). Se escriben solo por las funciones.
alter table public.tarjeta_consumos enable row level security;
alter table public.tarjeta_comercios enable row level security;
revoke all on public.tarjeta_consumos from anon, authenticated;
revoke all on public.tarjeta_comercios from anon, authenticated;
grant select on public.tarjeta_consumos, public.tarjeta_comercios to authenticated;
drop policy if exists tarjeta_consumos_select on public.tarjeta_consumos;
create policy tarjeta_consumos_select on public.tarjeta_consumos for select to authenticated using (public.lz_puede_operar_finanzas(sociedad_id));
drop policy if exists tarjeta_comercios_select on public.tarjeta_comercios;
create policy tarjeta_comercios_select on public.tarjeta_comercios for select to authenticated using (public.lz_puede_operar_finanzas(sociedad_id));

-- 1) Guardar los renglones leídos del resumen (Finanzas). Si se vuelve a subir, solo agrega los que no estaban (misma clave).
create or replace function public.guardar_consumos_tarjeta(p_resumen_id uuid, p_consumos jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_nuevos integer := 0;
begin
  select id, sociedad_id, cuenta_id into r from tarjeta_resumenes where id = p_resumen_id;
  if r.id is null then raise exception 'No se encontró el resumen'; end if;
  if not lz_puede_operar_finanzas(r.sociedad_id) then raise exception 'No tenés permiso para guardar consumos de la tarjeta'; end if;
  if jsonb_typeof(p_consumos) is distinct from 'array' then raise exception 'Faltan los consumos'; end if;
  insert into tarjeta_consumos (sociedad_id, cuenta_id, resumen_id, fecha, descripcion, comercio, cupon, cuota_n, cuota_de, importe, moneda, tipo, clase, clave, created_by)
  select r.sociedad_id, r.cuenta_id, r.id, (c->>'fecha')::date, btrim(c->>'descripcion'), btrim(c->>'comercio'), nullif(c->>'cupon', ''),
         nullif(c->>'cuota_n', '')::integer, nullif(c->>'cuota_de', '')::integer, (c->>'importe')::numeric, c->>'moneda', coalesce(c->>'tipo', 'consumo'),
         case when coalesce(c->>'tipo', 'consumo') = 'consumo' then k.clase end, c->>'clave', auth.uid()
  from jsonb_array_elements(p_consumos) c
  left join tarjeta_comercios k on k.sociedad_id = r.sociedad_id and k.comercio = btrim(c->>'comercio')
  on conflict (resumen_id, clave) do nothing;
  get diagnostics v_nuevos = row_count;
  return jsonb_build_object('nuevos', v_nuevos, 'ya_estaban', jsonb_array_length(p_consumos) - v_nuevos);
end $$;

-- 2) Clase de un comercio (una vez: vale para todos sus consumos, los de antes y los que vengan) o de un solo consumo (Finanzas).
create or replace function public.clasificar_consumo_tarjeta(p_sociedad_id uuid, p_comercio text, p_clase text, p_consumo_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer := 0;
begin
  if not lz_puede_operar_finanzas(p_sociedad_id) then raise exception 'No tenés permiso para clasificar consumos'; end if;
  if p_clase is not null and p_clase not in ('compra', 'servicio', 'personal') then raise exception 'Clase inválida: %', p_clase; end if;
  if p_consumo_id is not null then
    update tarjeta_consumos set clase = p_clase, clase_manual = true where id = p_consumo_id and sociedad_id = p_sociedad_id and tipo = 'consumo';
    get diagnostics v_n = row_count;
    if v_n = 0 then raise exception 'No se encontró el consumo'; end if;
    return jsonb_build_object('consumos', v_n);
  end if;
  if btrim(coalesce(p_comercio, '')) = '' then raise exception 'Falta el comercio'; end if;
  insert into tarjeta_comercios (sociedad_id, comercio, clase, updated_at, updated_by)
  values (p_sociedad_id, btrim(p_comercio), p_clase, now(), auth.uid())
  on conflict (sociedad_id, comercio) do update set clase = excluded.clase, updated_at = now(), updated_by = auth.uid();
  update tarjeta_consumos set clase = p_clase
  where sociedad_id = p_sociedad_id and comercio = btrim(p_comercio) and tipo = 'consumo' and not clase_manual;
  get diagnostics v_n = row_count;
  return jsonb_build_object('consumos', v_n);
end $$;

-- 3) La factura de un consumo (elegida o cargada desde el consumo) o «No tiene factura» con el motivo. Con nulos se deshace.
--    Los chicos (vendedor, administrativo) solo en consumos de compras; Finanzas en todos.
create or replace function public.marcar_consumo_tarjeta(p_consumo_id uuid, p_factura_compra_id uuid, p_sin_factura_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
begin
  if coalesce(get_my_role()::text, '') not in ('super_admin', 'admin', 'administrativo', 'vendedor') then
    raise exception 'No tenés permiso para marcar consumos';
  end if;
  select id, sociedad_id, clase, tipo into c from tarjeta_consumos where id = p_consumo_id;
  if c.id is null then raise exception 'No se encontró el consumo'; end if;
  if c.tipo <> 'consumo' then raise exception 'Los cargos del banco no llevan factura'; end if;
  if not lz_puede_operar_finanzas(c.sociedad_id) and c.clase is distinct from 'compra' then raise exception 'Ese consumo no es de compras'; end if;
  if p_factura_compra_id is not null and not exists (select 1 from facturas_compra where id = p_factura_compra_id and estado::text <> 'anulada') then
    raise exception 'No se encontró la factura (o está anulada)';
  end if;
  if p_factura_compra_id is null and p_sin_factura_motivo is not null and btrim(p_sin_factura_motivo) = '' then raise exception 'Escribí el motivo'; end if;
  update tarjeta_consumos
  set factura_compra_id = p_factura_compra_id,
      sin_factura_motivo = case when p_factura_compra_id is null then nullif(btrim(coalesce(p_sin_factura_motivo, '')), '') end,
      marcado_por = auth.uid(), marcado_at = now()
  where id = p_consumo_id;
  return jsonb_build_object('ok', true);
end $$;

-- 4) Lo que muestra la pantalla: los resúmenes, los consumos de uno (Finanzas: todos; los chicos: solo compras) y lo pagado con esa
--    tarjeta en las fechas del resumen (los chicos: solo los pagos de facturas de compra), para el cruce de lib/visa-cruce.
create or replace function public.consumos_de_tarjeta(p_sociedad_id uuid, p_resumen_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_fin boolean := lz_puede_operar_finanzas(p_sociedad_id);
  v_res record;
  v_desde date;
  v_hasta date;
begin
  if coalesce(get_my_role()::text, '') not in ('super_admin', 'admin', 'administrativo', 'vendedor') then
    raise exception 'No tenés permiso para ver los consumos de la tarjeta';
  end if;
  select r.id, r.cuenta_id, r.cierre into v_res from tarjeta_resumenes r
  where r.sociedad_id = p_sociedad_id and (p_resumen_id is null or r.id = p_resumen_id)
    and (v_fin or exists (select 1 from tarjeta_consumos t where t.resumen_id = r.id and t.clase = 'compra'))
  order by r.cierre desc limit 1;
  if v_res.id is null then
    return jsonb_build_object('resumenes', '[]'::jsonb, 'resumen_id', null, 'consumos', '[]'::jsonb, 'movimientos', '[]'::jsonb, 'finanzas', v_fin);
  end if;
  select min(fecha) - 25, v_res.cierre + 25 into v_desde, v_hasta from tarjeta_consumos where resumen_id = v_res.id;
  return jsonb_build_object(
    'finanzas', v_fin,
    'resumen_id', v_res.id,
    'resumenes', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'cierre', r.cierre, 'vencimiento', r.vencimiento, 'cuenta_id', r.cuenta_id, 'cuenta', c.nombre,
               'consumos', (select count(*) from tarjeta_consumos t where t.resumen_id = r.id and t.tipo = 'consumo' and (v_fin or t.clase = 'compra')))
             order by r.cierre desc)
      from tarjeta_resumenes r join cuentas_financieras c on c.id = r.cuenta_id
      where r.sociedad_id = p_sociedad_id and (v_fin or exists (select 1 from tarjeta_consumos t where t.resumen_id = r.id and t.clase = 'compra'))), '[]'::jsonb),
    'consumos', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'fecha', t.fecha, 'descripcion', t.descripcion, 'comercio', t.comercio, 'cupon', t.cupon,
               'cuota_n', t.cuota_n, 'cuota_de', t.cuota_de, 'importe', t.importe, 'moneda', t.moneda, 'tipo', t.tipo, 'clase', t.clase,
               'clase_manual', t.clase_manual, 'factura_compra_id', t.factura_compra_id, 'sin_factura_motivo', t.sin_factura_motivo,
               'factura', case when f.id is null then null else jsonb_build_object('numero', f.numero_factura, 'tipo', f.tipo_comprobante, 'total', f.total,
                 'moneda', f.moneda, 'fecha', f.fecha, 'archivo_url', f.archivo_url, 'proveedor', p.razon_social) end)
             order by t.tipo, t.fecha, t.descripcion)
      from tarjeta_consumos t
      left join facturas_compra f on f.id = t.factura_compra_id
      left join proveedores p on p.id = f.proveedor_id
      where t.resumen_id = v_res.id and (v_fin or (t.tipo = 'consumo' and t.clase = 'compra'))), '[]'::jsonb),
    'movimientos', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'fecha', m.fecha, 'monto', m.monto, 'moneda', m.moneda, 'factura_compra_id', m.factura_compra_id,
               'proveedor', coalesce(p.razon_social, ''), 'descripcion', case when v_fin then coalesce(m.descripcion, '') else '' end,
               'factura', case when f.id is null then null else btrim(coalesce(f.tipo_comprobante, '') || ' ' || coalesce(f.numero_factura, '')) end))
      from movimientos m
      left join proveedores p on p.id = m.proveedor_id
      left join facturas_compra f on f.id = m.factura_compra_id
      where m.cuenta_id = v_res.cuenta_id and not coalesce(m.anulado, false) and m.fecha between v_desde and v_hasta
        and (v_fin or m.factura_compra_id is not null)), '[]'::jsonb)
  );
end $$;

revoke all on function public.guardar_consumos_tarjeta(uuid, jsonb) from public, anon;
revoke all on function public.clasificar_consumo_tarjeta(uuid, text, text, uuid) from public, anon;
revoke all on function public.marcar_consumo_tarjeta(uuid, uuid, text) from public, anon;
revoke all on function public.consumos_de_tarjeta(uuid, uuid) from public, anon;
grant execute on function public.guardar_consumos_tarjeta(uuid, jsonb) to authenticated;
grant execute on function public.clasificar_consumo_tarjeta(uuid, text, text, uuid) to authenticated;
grant execute on function public.marcar_consumo_tarjeta(uuid, uuid, text) to authenticated;
grant execute on function public.consumos_de_tarjeta(uuid, uuid) to authenticated;

comment on table public.tarjeta_consumos is 'Consumos y cargos del banco de cada resumen de tarjeta, renglón por renglón; la factura o «No tiene» los pone una persona (02/11/2026).';
comment on table public.tarjeta_comercios is 'Clase de cada comercio de la tarjeta (compra / servicio / personal), se marca una vez (02/11/2026).';

commit;
