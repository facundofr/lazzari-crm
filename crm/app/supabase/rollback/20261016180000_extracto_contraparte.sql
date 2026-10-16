-- Vuelta atrás de 20261016180000_extracto_contraparte.sql: saca la función y la columna nuevas (se pierde a quién fue cada línea; nada más).
begin;
drop function if exists public.guardar_contrapartes_extracto(uuid, jsonb);
alter table public.extracto_movimientos drop column if exists contraparte;
commit;
