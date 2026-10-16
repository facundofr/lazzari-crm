-- 15/10/2026, con OK de Augusto ("avanzá con los 6 puntos de Remitos").
-- Remitos nueva (al nivel de Compras nueva):
--   1) profiles.prueba_remitos_nueva: casilla por usuario (solo la cambia el super_admin). Se prende para Augusto y Sebastián.
--   2) remitos.entregado_at / entregado_por / recibio / foto_url / foto_ia / nota_ia:
--      cuándo y quién marcó la entrega, quién firmó, la foto del remito firmado y lo que leyó la IA.
--   3) remito_respuestas: las respuestas a las "Preguntas" (PR facturado sin remito, remito sin PR, remito pendiente viejo),
--      para que no se vuelvan a preguntar. Se puede deshacer (anulada = true), no se borra.
-- Aditiva: no borra ni cambia datos existentes.
-- Vuelta atrás: supabase/rollback/20261016140000_remitos_nueva_parte1.sql
begin;

-- 1) Casilla por usuario
alter table public.profiles
  add column if not exists prueba_remitos_nueva boolean not null default false;
comment on column public.profiles.prueba_remitos_nueva is 'Ve la pantalla Remitos nueva (prueba)';

create or replace function public.lz_proteger_prueba_remitos()
returns trigger
language plpgsql
security definer
set search_path to public
as $function$
begin
  if new.prueba_remitos_nueva is distinct from old.prueba_remitos_nueva
    and not public.lz_puede_manejar_usuarios() then
    raise exception 'Solo el super admin puede cambiar "Prueba: Remitos nueva"';
  end if;
  return new;
end;
$function$;

drop trigger if exists lz_proteger_prueba_remitos on public.profiles;
create trigger lz_proteger_prueba_remitos
  before update on public.profiles
  for each row execute function public.lz_proteger_prueba_remitos();

update public.profiles set prueba_remitos_nueva = true
  where email in ('augusto@lazzari.com.ar', 'seba@lazzari.com.ar');

-- 2) Entrega del remito
alter table public.remitos
  add column if not exists entregado_at timestamptz,
  add column if not exists entregado_por uuid references public.profiles(id),
  add column if not exists recibio text,
  add column if not exists foto_url text,
  add column if not exists foto_ia jsonb,
  add column if not exists nota_ia text;
comment on column public.remitos.entregado_at is 'Cuándo se marcó entregado (Remitos nueva)';
comment on column public.remitos.entregado_por is 'Quién lo marcó entregado';
comment on column public.remitos.recibio is 'Nombre/aclaración de quien firmó el remito';
comment on column public.remitos.foto_url is 'Foto del remito firmado (bucket comprobantes)';
comment on column public.remitos.foto_ia is 'Lo que leyó la IA en la foto (fecha, firma, anotaciones, faltantes)';
comment on column public.remitos.nota_ia is 'Explicación de la IA / anotaciones de la entrega';

-- 3) Respuestas a las preguntas de Remitos
create table if not exists public.remito_respuestas (
  id uuid primary key default gen_random_uuid(),
  sociedad_id uuid not null references public.sociedades(id),
  tipo text not null check (tipo in ('pr_sin_remito', 'remito_sin_pr', 'remito_viejo')),
  entidad_id uuid not null,
  respuesta text not null,
  preguntar_desde date,
  nota text,
  anulada boolean not null default false,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
comment on table public.remito_respuestas is 'Respuestas a las preguntas de Remitos nueva (para no volver a preguntar). anulada = Deshacer.';
create index if not exists idx_remito_respuestas_entidad on public.remito_respuestas(sociedad_id, tipo, entidad_id) where not anulada;

alter table public.remito_respuestas enable row level security;
drop policy if exists remito_respuestas_select on public.remito_respuestas;
create policy remito_respuestas_select on public.remito_respuestas for select
  using (get_my_role() = any (array['super_admin'::user_role, 'admin'::user_role, 'vendedor'::user_role, 'administrativo'::user_role, 'viewer'::user_role]));
drop policy if exists remito_respuestas_insert on public.remito_respuestas;
create policy remito_respuestas_insert on public.remito_respuestas for insert
  with check (can_write());
drop policy if exists remito_respuestas_update on public.remito_respuestas;
create policy remito_respuestas_update on public.remito_respuestas for update
  using (can_write()) with check (can_write());

commit;
