-- Vínculo entre el nombre de proveedor de la lista de costos (nombre comercial/de fantasía)
-- y el proveedor del CRM (razón social). Se completa desde el presupuesto la primera vez y queda guardado.
create table if not exists public.catalogo_proveedores (
  id uuid primary key default gen_random_uuid(),
  sociedad_id uuid not null references public.sociedades(id),
  proveedor_lista text not null,
  proveedor_id uuid not null references public.proveedores(id) on delete cascade,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (sociedad_id, proveedor_lista)
);
alter table public.catalogo_proveedores enable row level security;
drop policy if exists catprov_select on public.catalogo_proveedores;
create policy catprov_select on public.catalogo_proveedores for select to authenticated
  using (public.get_my_role() = any (array['super_admin','admin','administrativo','vendedor']::public.user_role[]));
drop policy if exists catprov_write on public.catalogo_proveedores;
create policy catprov_write on public.catalogo_proveedores for all to authenticated
  using (public.get_my_role() = any (array['super_admin','admin','administrativo','vendedor']::public.user_role[]))
  with check (public.get_my_role() = any (array['super_admin','admin','administrativo','vendedor']::public.user_role[]));

-- Nombre de fantasía / comercial del proveedor (ej.: "Conoflex"), además de la razón social de ARCA.
-- La lista de costos usa el nombre comercial; con esto el CRM identifica al proveedor solo.
alter table public.proveedores add column if not exists nombre_fantasia text;
