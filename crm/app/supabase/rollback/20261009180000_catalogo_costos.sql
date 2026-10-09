-- Deshace supabase/migrations/20261009180000_catalogo_costos.sql (borra el catálogo cargado; los presupuestos no se tocan).
drop table if exists public.catalogo_costos_historial;
drop table if exists public.catalogo_costos;
