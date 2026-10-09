-- Catálogo de costos y precios de venta (fuente: catalogo_crm.csv del chat de listas).
-- Cambio ADITIVO: tablas nuevas. No toca productos, presupuestos, OC ni facturas.
-- Se carga y actualiza solo con: node scripts/importar-catalogo.cjs
-- Para deshacer: supabase/rollback/20261009180000_catalogo_costos.sql

create table if not exists public.catalogo_costos (
  id uuid primary key default gen_random_uuid(),
  proveedor text not null,
  codigo text not null,
  descripcion text not null,
  codigo_interno text unique,
  moneda text not null check (moneda in ('ARS','USD','USD divisa')),
  costo numeric not null,
  margen numeric,
  precio_venta numeric not null,
  activo boolean not null default true,
  actualizado_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (proveedor, codigo, descripcion)
);
create index if not exists catalogo_costos_busqueda_idx on public.catalogo_costos
  using gin (to_tsvector('spanish', proveedor || ' ' || codigo || ' ' || descripcion));

create table if not exists public.catalogo_costos_historial (
  id uuid primary key default gen_random_uuid(),
  catalogo_id uuid not null references public.catalogo_costos(id) on delete cascade,
  moneda_anterior text, costo_anterior numeric, precio_venta_anterior numeric,
  moneda_nueva text, costo_nuevo numeric, precio_venta_nuevo numeric,
  cambio text not null,               -- 'precio' | 'desactivado' | 'reactivado'
  created_at timestamptz not null default now()
);
create index if not exists catalogo_hist_idx on public.catalogo_costos_historial (catalogo_id, created_at);

-- Solo lectura desde el CRM (los costos no los ve el rol viewer). Escribe únicamente el script de importación.
alter table public.catalogo_costos enable row level security;
alter table public.catalogo_costos_historial enable row level security;
drop policy if exists catalogo_select on public.catalogo_costos;
create policy catalogo_select on public.catalogo_costos for select to authenticated
  using (public.get_my_role() = any (array['super_admin','admin','administrativo','vendedor']::public.user_role[]));
drop policy if exists catalogo_hist_select on public.catalogo_costos_historial;
create policy catalogo_hist_select on public.catalogo_costos_historial for select to authenticated
  using (public.get_my_role() = any (array['super_admin','admin','administrativo','vendedor']::public.user_role[]));
