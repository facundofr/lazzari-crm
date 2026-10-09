-- Mejoras de octubre 2026 — TODOS los cambios son ADITIVOS (no borra datos).
-- Para deshacer: supabase/rollback/20261010100000_compras_pagos_personalizacion_muestras_bcra.sql
--
--  1. Compras
--     · orden_compra_items: código/descripción del proveedor, talle y vínculo a la lista de costos
--       (la limpieza de OC NO cambia lo pedido ni los precios: agrega cómo lo llama el proveedor).
--     · ordenes_compra: "cerrar saldo" (lo que el proveedor no va a entregar deja de estar pendiente).
--     · proveedores: talles especiales y tolerancia de precio para aceptar diferencias solas.
--     · Vista orden_compra_items_pendientes: suma columnas nuevas y respeta el saldo cerrado.
--     · Funciones: normalizar_items_oc, cerrar_saldo_oc, aprender_equivalencias.
--  2. Plan de pagos: pagos_lotes + pagos_lote_items (el pago se registra con las funciones de OP existentes).
--  3. Personalización (bordados y estampados): talleres = proveedores marcados, precios, logos por cliente,
--     trabajos, prendas y liquidaciones mensuales (con factura o liquidación interna).
--  4. Muestras: renglones libres (de la lista de costos o escritos a mano) y estados simples por renglón.
--  5. Informe BCRA (Central de Deudores) por cliente, guardado mes a mes.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- Utilidades
-- ─────────────────────────────────────────────────────────────────────────────

-- ¿El usuario actual puede ver datos de esta sociedad?
create or replace function public.lz_es_de_sociedad(p_sociedad uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.active and p.role::text in ('super_admin', 'admin')
    )
    or exists (
      select 1 from public.user_sociedades us
      where us.user_id = auth.uid() and us.sociedad_id = p_sociedad
    );
$$;

-- ¿El usuario actual tiene alguno de estos roles (y está activo)?
create or replace function public.lz_tiene_rol(p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.active and p.role::text = any (p_roles)
  );
$$;

grant execute on function public.lz_es_de_sociedad(uuid) to authenticated;
grant execute on function public.lz_tiene_rol(text[]) to authenticated;

-- Numeración PREFIJO-AAAA-0001 por sociedad y año (la tabla debe tener numero, fecha y sociedad_id).
create or replace function public.lz_asignar_numero()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_pref text := tg_argv[0];
  v_anio text := to_char(coalesce(new.fecha, current_date), 'YYYY');
  v_sig integer;
begin
  if nullif(trim(coalesce(new.numero, '')), '') is not null then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext(tg_table_name || ':' || coalesce(new.sociedad_id::text, '') || ':' || v_anio));
  execute format(
    'select coalesce(max(substring(numero from ''([0-9]+)$'')::integer), 0) + 1 from public.%I where sociedad_id is not distinct from $1 and numero like $2',
    tg_table_name
  ) into v_sig using new.sociedad_id, v_pref || '-' || v_anio || '-%';
  new.numero := v_pref || '-' || v_anio || '-' || lpad(v_sig::text, 4, '0');
  return new;
end;
$$;

create or replace function public.lz_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Compras
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.orden_compra_items
  add column if not exists codigo_proveedor text,
  add column if not exists descripcion_proveedor text,
  add column if not exists talle text,
  add column if not exists catalogo_id uuid,
  add column if not exists normalizado_at timestamptz,
  add column if not exists normalizado_by uuid references public.profiles(id);

comment on column public.orden_compra_items.codigo_proveedor is 'Código del artículo según el proveedor (lista de costos). No reemplaza al código original de la OC.';
comment on column public.orden_compra_items.descripcion_proveedor is 'Descripción del artículo según el proveedor; se usa para que las facturas coincidan.';
comment on column public.orden_compra_items.talle is 'Talle normalizado del renglón (ej. 42, XL, 3XL).';

alter table public.ordenes_compra
  add column if not exists saldo_cerrado boolean not null default false,
  add column if not exists saldo_cerrado_at timestamptz,
  add column if not exists saldo_cerrado_by uuid references public.profiles(id),
  add column if not exists saldo_cerrado_motivo text;

comment on column public.ordenes_compra.saldo_cerrado is 'El proveedor no va a entregar/facturar lo que falta: deja de figurar como pendiente.';

-- es_transportista ya lo usa el formulario de proveedores; se asegura que exista.
alter table public.proveedores add column if not exists es_transportista boolean not null default false;

alter table public.proveedores
  add column if not exists talles_especiales text[] not null default '{}',
  add column if not exists tolerancia_precio_pct numeric(6,2) not null default 1
    check (tolerancia_precio_pct >= 0 and tolerancia_precio_pct <= 50),
  add column if not exists es_personalizador boolean not null default false,
  add column if not exists tipo_personalizacion text;

alter table public.proveedores drop constraint if exists proveedores_tipo_personalizacion_check;
alter table public.proveedores add constraint proveedores_tipo_personalizacion_check
  check (tipo_personalizacion is null or tipo_personalizacion in ('bordado', 'estampado', 'ambos'));

comment on column public.proveedores.talles_especiales is 'Talles que este proveedor factura como "talle especial" (ej. {3XL,4XL,5XL}).';
comment on column public.proveedores.tolerancia_precio_pct is 'Diferencia de precio (%) que se acepta sola al conciliar facturas contra OC.';
comment on column public.proveedores.es_personalizador is 'Taller de bordado/estampado (sector Personalización).';

-- Misma vista que antes (mismas columnas y en el mismo orden) + columnas nuevas al final.
-- Si la OC tiene el saldo cerrado, ya no queda nada pendiente de facturar.
create or replace view public.orden_compra_items_pendientes with (security_invoker = true) as
select i.id, i.orden_id, i.codigo, i.descripcion, i.cantidad, i.precio_unitario, i.iva_porcentaje, i.unidad, i.orden,
       coalesce(a.asignada, 0) as cantidad_asignada,
       case when coalesce(oc.saldo_cerrado, false) then 0 else i.cantidad - coalesce(a.asignada, 0) end as cantidad_pendiente,
       i.codigo_proveedor, i.descripcion_proveedor, i.talle, i.catalogo_id
from public.orden_compra_items i
join public.ordenes_compra oc on oc.id = i.orden_id
left join (
  select orden_compra_item_id, sum(cantidad) as asignada
  from public.factura_compra_asignaciones group by orden_compra_item_id
) a on a.orden_compra_item_id = i.id;
grant select on public.orden_compra_items_pendientes to authenticated;

-- Guarda la "traducción" de renglones de OC al artículo del proveedor (limpieza de OC).
-- p_items: [{id, codigo_proveedor, descripcion_proveedor, talle, catalogo_id}]
create or replace function public.normalizar_items_oc(p_sociedad_id uuid, p_items jsonb)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer := 0;
begin
  if not public.lz_tiene_rol(array['super_admin','admin','administrativo','vendedor'])
     or not public.lz_es_de_sociedad(p_sociedad_id) then
    raise exception 'No tenés permiso para modificar compras de esta sociedad' using errcode = '42501';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 3000 then
    raise exception 'Datos inválidos' using errcode = '22023';
  end if;

  update public.orden_compra_items i
  set codigo_proveedor      = nullif(trim(x->>'codigo_proveedor'), ''),
      descripcion_proveedor = nullif(trim(x->>'descripcion_proveedor'), ''),
      talle                 = nullif(upper(trim(x->>'talle')), ''),
      catalogo_id           = nullif(x->>'catalogo_id', '')::uuid,
      normalizado_at        = now(),
      normalizado_by        = auth.uid()
  from jsonb_array_elements(p_items) x, public.ordenes_compra oc
  where i.id = (x->>'id')::uuid
    and oc.id = i.orden_id
    and oc.sociedad_id = p_sociedad_id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Cierra (o reabre) el saldo pendiente de una OC.
create or replace function public.cerrar_saldo_oc(p_sociedad_id uuid, p_oc_id uuid, p_cerrar boolean, p_motivo text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.lz_tiene_rol(array['super_admin','admin','administrativo','vendedor'])
     or not public.lz_es_de_sociedad(p_sociedad_id) then
    raise exception 'No tenés permiso para modificar compras de esta sociedad' using errcode = '42501';
  end if;
  update public.ordenes_compra
  set saldo_cerrado = coalesce(p_cerrar, false),
      saldo_cerrado_at = case when coalesce(p_cerrar, false) then now() else null end,
      saldo_cerrado_by = case when coalesce(p_cerrar, false) then auth.uid() else null end,
      saldo_cerrado_motivo = case when coalesce(p_cerrar, false) then nullif(trim(p_motivo), '') else null end
  where id = p_oc_id and sociedad_id = p_sociedad_id;
  if not found then
    raise exception 'No se encontró la OC' using errcode = 'P0002';
  end if;
end;
$$;

-- Memoria por proveedor desde la carga individual de facturas.
-- p_equivalencias: [{producto_factura, producto_oc, codigo_proveedor}]
create or replace function public.aprender_equivalencias(p_sociedad_id uuid, p_proveedor_id uuid, p_equivalencias jsonb)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer := 0;
begin
  if not public.lz_tiene_rol(array['super_admin','admin','administrativo','vendedor'])
     or not public.lz_es_de_sociedad(p_sociedad_id) then
    raise exception 'No tenés permiso' using errcode = '42501';
  end if;
  if p_equivalencias is null or jsonb_typeof(p_equivalencias) <> 'array' then
    return 0;
  end if;
  if not exists (select 1 from public.proveedores where id = p_proveedor_id and sociedad_id = p_sociedad_id) then
    raise exception 'El proveedor no pertenece a la sociedad' using errcode = '42501';
  end if;
  insert into public.proveedor_equivalencias (sociedad_id, proveedor_id, producto_factura, producto_oc, codigo_proveedor, created_by)
  select p_sociedad_id, p_proveedor_id, trim(e->>'producto_factura'), trim(e->>'producto_oc'), nullif(trim(e->>'codigo_proveedor'), ''), auth.uid()
  from jsonb_array_elements(p_equivalencias) e
  where nullif(trim(e->>'producto_factura'), '') is not null and nullif(trim(e->>'producto_oc'), '') is not null
  on conflict (sociedad_id, proveedor_id, producto_factura, producto_oc)
  do update set veces = public.proveedor_equivalencias.veces + 1, updated_at = now(),
    codigo_proveedor = coalesce(excluded.codigo_proveedor, public.proveedor_equivalencias.codigo_proveedor);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.normalizar_items_oc(uuid, jsonb) to authenticated;
grant execute on function public.cerrar_saldo_oc(uuid, uuid, boolean, text) to authenticated;
grant execute on function public.aprender_equivalencias(uuid, uuid, jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Plan de pagos
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.pagos_lotes (
  id uuid primary key default gen_random_uuid(),
  sociedad_id uuid not null references public.sociedades(id),
  numero text,
  fecha date not null default current_date,
  estado text not null default 'borrador' check (estado in ('borrador', 'en_banco', 'cerrado', 'anulado')),
  notas text,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sociedad_id, numero)
);

create table if not exists public.pagos_lote_items (
  id uuid primary key default gen_random_uuid(),
  lote_id uuid not null references public.pagos_lotes(id) on delete cascade,
  sociedad_id uuid not null references public.sociedades(id),
  proveedor_id uuid not null references public.proveedores(id),
  moneda text not null default 'ARS' check (moneda in ('ARS', 'USD')),
  facturas jsonb not null default '[]'::jsonb,        -- [{id, numero, monto}]
  notas_credito jsonb not null default '[]'::jsonb,   -- [{nc_id, factura_compra_id, monto}]
  monto_bruto numeric(20,2) not null default 0,
  nc_aplicado numeric(20,2) not null default 0,
  base_retencion numeric(20,2) not null default 0,
  retencion_pct numeric(8,4) not null default 0,
  retencion_monto numeric(20,2) not null default 0,
  neto numeric(20,2) not null default 0,
  forma_pago text not null default 'transferencia',
  cuit text,
  razon_social text,
  cbu text,
  alias_bancario text,
  banco text,
  titular_cuenta text,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'pagado', 'omitido')),
  request_key uuid not null default gen_random_uuid(),
  orden_pago_id uuid references public.ordenes_pago(id) on delete set null,
  fecha_pago date,
  referencia text,
  comprobante_url text,
  comprobante_nombre text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists pagos_lote_items_lote_idx on public.pagos_lote_items (lote_id);
create index if not exists pagos_lote_items_prov_idx on public.pagos_lote_items (sociedad_id, proveedor_id);

drop trigger if exists pagos_lotes_numero on public.pagos_lotes;
create trigger pagos_lotes_numero before insert on public.pagos_lotes
  for each row execute function public.lz_asignar_numero('PLAN');
drop trigger if exists pagos_lotes_updated on public.pagos_lotes;
create trigger pagos_lotes_updated before update on public.pagos_lotes
  for each row execute function public.lz_set_updated_at();
drop trigger if exists pagos_lote_items_updated on public.pagos_lote_items;
create trigger pagos_lote_items_updated before update on public.pagos_lote_items
  for each row execute function public.lz_set_updated_at();

alter table public.pagos_lotes enable row level security;
alter table public.pagos_lote_items enable row level security;
drop policy if exists pagos_lotes_rw on public.pagos_lotes;
create policy pagos_lotes_rw on public.pagos_lotes for all to authenticated
  using (public.lz_es_de_sociedad(sociedad_id) and public.lz_tiene_rol(array['super_admin','admin','administrativo']))
  with check (public.lz_es_de_sociedad(sociedad_id) and public.lz_tiene_rol(array['super_admin','admin','administrativo']));
drop policy if exists pagos_lote_items_rw on public.pagos_lote_items;
create policy pagos_lote_items_rw on public.pagos_lote_items for all to authenticated
  using (public.lz_es_de_sociedad(sociedad_id) and public.lz_tiene_rol(array['super_admin','admin','administrativo']))
  with check (public.lz_es_de_sociedad(sociedad_id) and public.lz_tiene_rol(array['super_admin','admin','administrativo']));
grant select, insert, update, delete on public.pagos_lotes, public.pagos_lote_items to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Personalización (bordados y estampados)
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.personalizacion_precios (
  id uuid primary key default gen_random_uuid(),
  sociedad_id uuid not null references public.sociedades(id),
  proveedor_id uuid not null references public.proveedores(id) on delete cascade,
  tecnica text not null,                 -- bordado, estampa, DTF, vinilo, sublimado…
  detalle text not null default '',      -- tamaño / ubicación / puntadas
  precio numeric(20,2) not null check (precio >= 0),
  moneda text not null default 'ARS' check (moneda in ('ARS', 'USD')),
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists personalizacion_precios_prov_idx on public.personalizacion_precios (proveedor_id);

create table if not exists public.personalizacion_logos (
  id uuid primary key default gen_random_uuid(),
  sociedad_id uuid not null references public.sociedades(id),
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  nombre text not null,
  tecnica text,
  ubicacion text,
  proveedor_id uuid references public.proveedores(id) on delete set null,
  ultimo_costo numeric(20,2),
  archivo_url text,
  archivo_nombre text,
  notas text,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists personalizacion_logos_cliente_idx on public.personalizacion_logos (cliente_id);

create table if not exists public.personalizacion_liquidaciones (
  id uuid primary key default gen_random_uuid(),
  sociedad_id uuid not null references public.sociedades(id),
  numero text,
  fecha date not null default current_date,
  proveedor_id uuid not null references public.proveedores(id),
  periodo_desde date,
  periodo_hasta date,
  tipo text not null check (tipo in ('factura', 'interna')),
  moneda text not null default 'ARS' check (moneda in ('ARS', 'USD')),
  total numeric(20,2) not null default 0,
  descuento_fallas numeric(20,2) not null default 0,
  factura_compra_id uuid references public.facturas_compra(id) on delete set null,
  estado text not null default 'enviada_pagos' check (estado in ('enviada_pagos', 'anulada')),
  notas text,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  unique (sociedad_id, numero)
);

create table if not exists public.personalizacion_trabajos (
  id uuid primary key default gen_random_uuid(),
  sociedad_id uuid not null references public.sociedades(id),
  numero text,
  fecha date not null default current_date,
  proveedor_id uuid not null references public.proveedores(id),
  cliente_id uuid references public.clientes(id) on delete set null,
  presupuesto_id uuid references public.presupuestos(id) on delete set null,
  estado text not null default 'en_taller' check (estado in ('en_taller', 'listo_parcial', 'listo', 'retirado', 'anulado')),
  fecha_estimada date,
  fecha_retiro date,
  moneda text not null default 'ARS' check (moneda in ('ARS', 'USD')),
  liquidacion_id uuid references public.personalizacion_liquidaciones(id) on delete set null,
  observaciones text,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sociedad_id, numero)
);
create index if not exists personalizacion_trabajos_prov_idx on public.personalizacion_trabajos (sociedad_id, proveedor_id, fecha);
create index if not exists personalizacion_trabajos_cliente_idx on public.personalizacion_trabajos (cliente_id);

create table if not exists public.personalizacion_items (
  id uuid primary key default gen_random_uuid(),
  trabajo_id uuid not null references public.personalizacion_trabajos(id) on delete cascade,
  prenda text not null,
  talle text,
  color text,
  cantidad integer not null check (cantidad > 0),
  cantidad_lista integer not null default 0 check (cantidad_lista >= 0),
  cantidad_falla integer not null default 0 check (cantidad_falla >= 0),
  tecnica text,
  ubicacion text,
  logo_id uuid references public.personalizacion_logos(id) on delete set null,
  costo_unitario numeric(20,2) not null default 0 check (costo_unitario >= 0),
  presupuesto_item_id uuid references public.presupuesto_items(id) on delete set null,
  notas text,
  orden integer not null default 0,
  created_at timestamptz not null default now(),
  check (cantidad_lista + cantidad_falla <= cantidad)
);
create index if not exists personalizacion_items_trabajo_idx on public.personalizacion_items (trabajo_id);

drop trigger if exists personalizacion_trabajos_numero on public.personalizacion_trabajos;
create trigger personalizacion_trabajos_numero before insert on public.personalizacion_trabajos
  for each row execute function public.lz_asignar_numero('PERS');
drop trigger if exists personalizacion_liquidaciones_numero on public.personalizacion_liquidaciones;
create trigger personalizacion_liquidaciones_numero before insert on public.personalizacion_liquidaciones
  for each row execute function public.lz_asignar_numero('LIQ-PERS');
drop trigger if exists personalizacion_trabajos_updated on public.personalizacion_trabajos;
create trigger personalizacion_trabajos_updated before update on public.personalizacion_trabajos
  for each row execute function public.lz_set_updated_at();
drop trigger if exists personalizacion_logos_updated on public.personalizacion_logos;
create trigger personalizacion_logos_updated before update on public.personalizacion_logos
  for each row execute function public.lz_set_updated_at();
drop trigger if exists personalizacion_precios_updated on public.personalizacion_precios;
create trigger personalizacion_precios_updated before update on public.personalizacion_precios
  for each row execute function public.lz_set_updated_at();

alter table public.personalizacion_precios enable row level security;
alter table public.personalizacion_logos enable row level security;
alter table public.personalizacion_liquidaciones enable row level security;
alter table public.personalizacion_trabajos enable row level security;
alter table public.personalizacion_items enable row level security;

drop policy if exists pers_precios_rw on public.personalizacion_precios;
create policy pers_precios_rw on public.personalizacion_precios for all to authenticated
  using (public.lz_es_de_sociedad(sociedad_id))
  with check (public.lz_es_de_sociedad(sociedad_id) and public.lz_tiene_rol(array['super_admin','admin','administrativo','vendedor']));
drop policy if exists pers_logos_rw on public.personalizacion_logos;
create policy pers_logos_rw on public.personalizacion_logos for all to authenticated
  using (public.lz_es_de_sociedad(sociedad_id))
  with check (public.lz_es_de_sociedad(sociedad_id) and public.lz_tiene_rol(array['super_admin','admin','administrativo','vendedor']));
drop policy if exists pers_trabajos_rw on public.personalizacion_trabajos;
create policy pers_trabajos_rw on public.personalizacion_trabajos for all to authenticated
  using (public.lz_es_de_sociedad(sociedad_id))
  with check (public.lz_es_de_sociedad(sociedad_id) and public.lz_tiene_rol(array['super_admin','admin','administrativo','vendedor']));
drop policy if exists pers_items_rw on public.personalizacion_items;
create policy pers_items_rw on public.personalizacion_items for all to authenticated
  using (exists (select 1 from public.personalizacion_trabajos t where t.id = trabajo_id and public.lz_es_de_sociedad(t.sociedad_id)))
  with check (exists (select 1 from public.personalizacion_trabajos t where t.id = trabajo_id and public.lz_es_de_sociedad(t.sociedad_id))
              and public.lz_tiene_rol(array['super_admin','admin','administrativo','vendedor']));
-- Las liquidaciones generan deuda con el taller: solo administración.
drop policy if exists pers_liq_select on public.personalizacion_liquidaciones;
create policy pers_liq_select on public.personalizacion_liquidaciones for select to authenticated
  using (public.lz_es_de_sociedad(sociedad_id));
drop policy if exists pers_liq_write on public.personalizacion_liquidaciones;
create policy pers_liq_write on public.personalizacion_liquidaciones for all to authenticated
  using (public.lz_es_de_sociedad(sociedad_id) and public.lz_tiene_rol(array['super_admin','admin','administrativo']))
  with check (public.lz_es_de_sociedad(sociedad_id) and public.lz_tiene_rol(array['super_admin','admin','administrativo']));

grant select, insert, update, delete on public.personalizacion_precios, public.personalizacion_logos,
  public.personalizacion_liquidaciones, public.personalizacion_trabajos, public.personalizacion_items to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Muestras: renglones libres y estados simples
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.muestra_envio_items alter column producto_id drop not null;
alter table public.muestra_envio_items
  add column if not exists codigo text,
  add column if not exists descripcion text,
  add column if not exists talle text,
  add column if not exists color text,
  add column if not exists catalogo_id uuid,
  add column if not exists cantidad_vendida integer not null default 0 check (cantidad_vendida >= 0),
  add column if not exists cantidad_baja integer not null default 0 check (cantidad_baja >= 0),
  add column if not exists nota text;
alter table public.muestra_envio_items drop constraint if exists muestra_envio_items_resueltas_check;
alter table public.muestra_envio_items add constraint muestra_envio_items_resueltas_check
  check (cantidad_devuelta + cantidad_vendida + cantidad_baja <= cantidad);

comment on column public.muestra_envio_items.cantidad_vendida is 'Muestras que el cliente se quedó (para cobrar).';
comment on column public.muestra_envio_items.cantidad_baja is 'Muestras regaladas o dadas de baja.';

alter table public.muestra_envios drop constraint if exists muestra_envios_estado_check;
alter table public.muestra_envios add constraint muestra_envios_estado_check
  check (estado in ('en_cliente', 'parcial', 'devuelto', 'cerrado'));

-- El control de stock solo aplica a las prendas del inventario viejo (producto_id cargado).
create or replace function public.validar_stock_muestra_item()
returns trigger
language plpgsql
as $$
declare
  total_disponible integer;
  total_asignado integer;
  sociedad_producto uuid;
  sociedad_envio uuid;
begin
  if new.producto_id is null then
    return new;
  end if;

  select stock_total, sociedad_id into total_disponible, sociedad_producto
  from public.muestra_productos
  where id = new.producto_id
  for update;

  select sociedad_id into sociedad_envio
  from public.muestra_envios
  where id = new.envio_id;

  if sociedad_producto is null or sociedad_envio is null or sociedad_producto <> sociedad_envio then
    raise exception 'La muestra y el envío deben pertenecer a la misma sociedad';
  end if;

  select coalesce(sum(cantidad - cantidad_devuelta - coalesce(cantidad_vendida, 0) - coalesce(cantidad_baja, 0)), 0)
    into total_asignado
  from public.muestra_envio_items
  where producto_id = new.producto_id
    and id <> coalesce(new.id, gen_random_uuid());

  if total_asignado + (new.cantidad - new.cantidad_devuelta - coalesce(new.cantidad_vendida, 0) - coalesce(new.cantidad_baja, 0)) > total_disponible then
    raise exception 'Stock de muestra insuficiente';
  end if;

  return new;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Informe BCRA por cliente
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.cliente_bcra_informes (
  id uuid primary key default gen_random_uuid(),
  sociedad_id uuid not null references public.sociedades(id),
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  cuit text not null,
  mes text not null,                          -- AAAA-MM en que se consultó
  periodo_bcra text,                          -- último período informado por el BCRA (AAAAMM)
  denominacion text,
  peor_situacion integer,                     -- 1 a 5 (null = sin deudas informadas)
  deuda_total numeric(20,2) not null default 0,  -- en miles de pesos, como informa el BCRA
  entidades integer not null default 0,
  cheques_rechazados integer not null default 0,
  cheques_sin_pagar integer not null default 0,
  monto_cheques_sin_pagar numeric(20,2) not null default 0,
  proceso_judicial boolean not null default false,
  semaforo text not null default 'gris' check (semaforo in ('verde', 'amarillo', 'rojo', 'gris')),
  historial jsonb,                            -- 24 meses: [{periodo, peor_situacion, deuda}]
  data jsonb,                                 -- respuesta resumida
  error text,
  consultado_at timestamptz not null default now(),
  consultado_by uuid references public.profiles(id) default auth.uid(),
  unique (cliente_id, mes)
);
create index if not exists cliente_bcra_sociedad_idx on public.cliente_bcra_informes (sociedad_id, mes);

alter table public.cliente_bcra_informes enable row level security;
drop policy if exists cliente_bcra_rw on public.cliente_bcra_informes;
create policy cliente_bcra_rw on public.cliente_bcra_informes for all to authenticated
  using (public.lz_es_de_sociedad(sociedad_id))
  with check (public.lz_es_de_sociedad(sociedad_id));
grant select, insert, update, delete on public.cliente_bcra_informes to authenticated;

commit;
