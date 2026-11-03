-- Vuelta atrás de 20261103090000_lz_migraciones_corridas.sql: saca la tabla del registro de migraciones.
-- Solo se pierde el registro de qué archivos se corrieron desde el 03/11 (ningún dato del CRM).
begin;

drop table if exists public.lz_migraciones_corridas;

commit;
