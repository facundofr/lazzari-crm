-- Vuelta atrás de 20261016140000_remitos_nueva_parte1.sql (pierde lo cargado en las columnas y la tabla nuevas).
begin;
drop table if exists public.remito_respuestas;
alter table public.remitos
  drop column if exists entregado_at,
  drop column if exists entregado_por,
  drop column if exists recibio,
  drop column if exists foto_url,
  drop column if exists foto_ia,
  drop column if exists nota_ia;
drop trigger if exists lz_proteger_prueba_remitos on public.profiles;
drop function if exists public.lz_proteger_prueba_remitos();
alter table public.profiles drop column if exists prueba_remitos_nueva;
commit;
