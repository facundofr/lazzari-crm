-- Pendientes centralizados (pedido de Augusto 14/10/2026): respuesta, área, link a la pantalla y tipo (hacer / responder).
-- Solo agrega columnas (vacías). No toca ni borra datos. Vuelta atrás: supabase/rollback/20261014170000_pendientes_respuesta_area_link.sql
begin;
alter table public.pendientes add column if not exists respuesta text;
alter table public.pendientes add column if not exists area text;
alter table public.pendientes add column if not exists link text;
alter table public.pendientes add column if not exists tipo text not null default 'hacer';
alter table public.pendientes drop constraint if exists pendientes_tipo_check;
alter table public.pendientes add constraint pendientes_tipo_check check (tipo in ('hacer', 'responder'));
commit;
