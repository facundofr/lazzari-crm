-- Registro de las migraciones corridas (auditoría 02/11/2026, P11).
-- Desde el 08/10 las migraciones se corren con scripts/db/migrar.cjs y no quedaban anotadas en ningún lado
-- (supabase_migrations.schema_migrations termina en 20261008120000). Con esta tabla, migrar.cjs anota cada archivo
-- que corre (migración o vuelta atrás) en la misma transacción, y scripts/db/verificar-migraciones.cjs (solo lectura)
-- compara los archivos del repo contra lo anotado y contra las funciones vivas de la base.
-- Solo agrega una tabla nueva y vacía: no toca datos ni otras tablas. La tabla no tiene políticas: el CRM no la lee
-- (con RLS prendido y sin políticas, la app no ve nada); solo la usan los scripts con la conexión directa.
-- Prueba: scripts/db/pruebas/lz_migraciones_corridas.sql
-- Vuelta atrás: supabase/rollback/20261103090000_lz_migraciones_corridas.sql
begin;

create table if not exists public.lz_migraciones_corridas (
  archivo text primary key,             -- ej. supabase/migrations/20261103090000_lz_migraciones_corridas.sql
  tipo text not null check (tipo in ('migracion', 'vuelta_atras')),
  corrida_at timestamptz not null default now(),
  usuario text not null default current_user
);

alter table public.lz_migraciones_corridas enable row level security;

comment on table public.lz_migraciones_corridas is
  'Migraciones corridas con scripts/db/migrar.cjs (desde el 03/11/2026). Las anteriores al 08/10 están en supabase_migrations.schema_migrations.';

commit;
