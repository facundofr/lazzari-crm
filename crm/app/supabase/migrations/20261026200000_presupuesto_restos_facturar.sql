-- Resto a facturar (Augusto 26/10/2026): si al facturar un PR se sacan renglones o se baja la cantidad, lo que falta
-- queda como "resto" del mismo PR para facturarlo después (Finanzas Lazza > Facturar) o marcarlo "No facturar".
-- Solo AGREGA una tabla nueva: no cambia ni borra nada de lo que ya existe.
-- Vuelta atrás: supabase/rollback/20261026200000_presupuesto_restos_facturar.sql
begin;

create table if not exists public.presupuesto_restos_facturar (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users(id),
  sociedad_id uuid not null,
  presupuesto_id uuid not null references public.presupuestos(id),
  factura_id uuid references public.facturas(id),          -- la factura que dejó este resto
  moneda text not null default 'ARS',
  items jsonb not null default '[]'::jsonb,                -- [{descripcion, cantidad, precio_venta (neto), iva_porcentaje, total}]
  subtotal numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'facturado', 'no_facturar')),
  factura_resto_id uuid references public.facturas(id),    -- la factura que lo facturó
  resuelto_at timestamptz,
  resuelto_por uuid references auth.users(id)
);

create index if not exists presupuesto_restos_facturar_pr_idx on public.presupuesto_restos_facturar (presupuesto_id);
create index if not exists presupuesto_restos_facturar_pend_idx on public.presupuesto_restos_facturar (sociedad_id) where estado = 'pendiente';

comment on table public.presupuesto_restos_facturar is 'Lo que quedó sin facturar de un PR (renglones sacados o cantidades menores) para facturarlo después o marcar No facturar.';

-- Mismos permisos que facturas.
alter table public.presupuesto_restos_facturar enable row level security;
drop policy if exists presupuesto_restos_facturar_select on public.presupuesto_restos_facturar;
create policy presupuesto_restos_facturar_select on public.presupuesto_restos_facturar for select
  using (get_my_role() = any (array['super_admin', 'admin', 'vendedor', 'administrativo', 'viewer']::user_role[]));
drop policy if exists presupuesto_restos_facturar_insert on public.presupuesto_restos_facturar;
create policy presupuesto_restos_facturar_insert on public.presupuesto_restos_facturar for insert
  with check (get_my_role() = any (array['super_admin', 'admin', 'administrativo']::user_role[]));
drop policy if exists presupuesto_restos_facturar_update on public.presupuesto_restos_facturar;
create policy presupuesto_restos_facturar_update on public.presupuesto_restos_facturar for update
  using (get_my_role() = any (array['super_admin', 'admin', 'administrativo']::user_role[]));

commit;
