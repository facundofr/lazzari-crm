-- Vuelta atrás de 20261029180000_borrar_tablas_personalizacion.sql: vuelve a crear las 5 tablas de Personalización VACÍAS,
-- con las mismas columnas, disparadores, permisos y reglas de acceso que tenían (copiado de 20261010100000, sección 3).
begin;

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

commit;
