-- Asistente que hace cosas, Etapa 1 (Augusto 17/10): historial de lo que hizo la IA, con Deshacer.
-- Cada fila = un cambio que el usuario aprobó con "Hacer": qué pidió, qué registro tocó, cómo estaba antes y cómo quedó.
-- Solo AGREGA una tabla nueva: no cambia ni borra nada de lo que ya existe.
-- Vuelta atrás: supabase/rollback/20261017100000_ia_acciones.sql
begin;

create table if not exists public.ia_acciones (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid not null default auth.uid() references auth.users(id),
  sociedad_id uuid,
  pedido text,                       -- lo que escribió el usuario
  tipo text not null,                -- 'editar' | 'crear'
  tabla text not null,
  registro_id uuid not null,
  resumen text not null,             -- "Mail de Nexo: compras@nexo.com"
  antes jsonb not null default '{}'::jsonb,
  despues jsonb not null default '{}'::jsonb,
  estado text not null default 'hecha' check (estado in ('hecha', 'deshecha')),
  deshecha_at timestamptz,
  deshecha_por uuid references auth.users(id),
  nota_deshacer text
);

create index if not exists ia_acciones_creado_idx on public.ia_acciones (created_at desc);

comment on table public.ia_acciones is 'Asistente IA: cambios aprobados con "Hacer" (antes/después) para poder deshacerlos.';

-- Etapa 1: solo el super_admin (Augusto) ve y usa el historial.
alter table public.ia_acciones enable row level security;
drop policy if exists ia_acciones_select on public.ia_acciones;
create policy ia_acciones_select on public.ia_acciones for select
  using ((select get_my_role()) = 'super_admin');
drop policy if exists ia_acciones_insert on public.ia_acciones;
create policy ia_acciones_insert on public.ia_acciones for insert
  with check ((select get_my_role()) = 'super_admin' and user_id = auth.uid());
drop policy if exists ia_acciones_update on public.ia_acciones;
create policy ia_acciones_update on public.ia_acciones for update
  using ((select get_my_role()) = 'super_admin');

commit;
