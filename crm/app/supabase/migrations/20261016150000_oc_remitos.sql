-- 15/10/2026, con OK de Augusto ("avanzá con el plan y las 3 recomendaciones").
-- Compras nueva > Esperando: "Foto del remito del proveedor".
--   oc_remitos: cada remito del proveedor que llegó (foto, lo que leyó la IA y lo que se cargó como recibido en la OC).
--   Sirve para ver la foto desde la OC y para Deshacer (anulado = true: no se borra).
--   NO mueve stock (pedido de Augusto): solo registra lo recibido en la OC.
-- Aditiva: no borra ni cambia datos existentes.
-- Vuelta atrás: supabase/rollback/20261016150000_oc_remitos.sql
begin;

create table if not exists public.oc_remitos (
  id uuid primary key default gen_random_uuid(),
  sociedad_id uuid not null references public.sociedades(id),
  orden_id uuid not null references public.ordenes_compra(id),
  proveedor_id uuid references public.proveedores(id),
  numero_remito text,
  fecha_remito date,
  foto_url text,
  leido_ia jsonb,
  cargado jsonb not null default '[]'::jsonb,
  estado_antes text,
  estado_despues text,
  nota text,
  anulado boolean not null default false,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
comment on table public.oc_remitos is 'Remitos del proveedor (foto + lectura de la IA) cargados como recibido en la OC desde Compras nueva. anulado = Deshacer.';
comment on column public.oc_remitos.cargado is 'Renglones cargados: [{item_id, cantidad, antes, despues}] (cantidad_recibida antes y después)';
create index if not exists idx_oc_remitos_orden on public.oc_remitos(sociedad_id, orden_id) where not anulado;

alter table public.oc_remitos enable row level security;
drop policy if exists oc_remitos_select on public.oc_remitos;
create policy oc_remitos_select on public.oc_remitos for select
  using (get_my_role() = any (array['super_admin'::user_role, 'admin'::user_role, 'vendedor'::user_role, 'administrativo'::user_role, 'viewer'::user_role]));
drop policy if exists oc_remitos_insert on public.oc_remitos;
create policy oc_remitos_insert on public.oc_remitos for insert
  with check (can_write());
drop policy if exists oc_remitos_update on public.oc_remitos;
create policy oc_remitos_update on public.oc_remitos for update
  using (can_write()) with check (can_write());

commit;
