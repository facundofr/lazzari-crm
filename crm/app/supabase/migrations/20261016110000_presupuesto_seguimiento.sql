-- 16/10/2026. Presupuestos nuevo, tanda D1: seguimiento de PR pendientes y vencidos.
-- Una tabla nueva (historial de contactos y resultados de cada PR). No toca ninguna tabla existente.
-- Cada fila es un hecho: "le mandé mail", "no contestó", "pidió cambios", "se perdió", "posponer hasta X", "extendí la validez".
-- Último contacto y próxima fecha se calculan con la fila más nueva. Deshacer = borrar la propia fila.
-- Vuelta atrás: supabase/rollback/20261016110000_presupuesto_seguimiento.sql
begin;

create table if not exists public.presupuesto_seguimiento (
  id uuid primary key default gen_random_uuid(),
  sociedad_id uuid not null references public.sociedades(id) on delete restrict,
  presupuesto_id uuid not null references public.presupuestos(id) on delete cascade,
  tipo text not null check (tipo in ('contacto', 'resultado', 'posponer', 'extension', 'nota')),
  canal text check (canal in ('mail', 'whatsapp', 'llamada', 'otro')),
  resultado text check (resultado in ('aprobo', 'pidio_cambios', 'no_contesto', 'perdido')),
  detalle text,
  proxima_fecha date,
  user_id uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists presupuesto_seguimiento_pr_idx on public.presupuesto_seguimiento(presupuesto_id, created_at desc);
create index if not exists presupuesto_seguimiento_prox_idx on public.presupuesto_seguimiento(sociedad_id, proxima_fecha) where proxima_fecha is not null;

comment on table public.presupuesto_seguimiento is 'Presupuestos nuevo: historial de seguimiento de cada PR (contactos, resultados, posponer, extensiones).';

alter table public.presupuesto_seguimiento enable row level security;
revoke all on public.presupuesto_seguimiento from anon, authenticated;
grant select, insert, delete on public.presupuesto_seguimiento to authenticated;

drop policy if exists presupuesto_seguimiento_select on public.presupuesto_seguimiento;
create policy presupuesto_seguimiento_select on public.presupuesto_seguimiento
  for select to authenticated
  using (get_my_role() = any (array['super_admin'::user_role, 'admin'::user_role, 'vendedor'::user_role, 'administrativo'::user_role, 'viewer'::user_role]));

drop policy if exists presupuesto_seguimiento_insert on public.presupuesto_seguimiento;
create policy presupuesto_seguimiento_insert on public.presupuesto_seguimiento
  for insert to authenticated
  with check (get_my_role() = any (array['super_admin'::user_role, 'admin'::user_role, 'vendedor'::user_role, 'administrativo'::user_role]));

-- Deshacer: cada uno borra solo lo suyo; admin puede borrar cualquiera.
drop policy if exists presupuesto_seguimiento_delete on public.presupuesto_seguimiento;
create policy presupuesto_seguimiento_delete on public.presupuesto_seguimiento
  for delete to authenticated
  using (user_id = auth.uid() or is_admin_or_above());

commit;
