-- 16/10/2026: la lista de costos se baja entera al buscar (búsqueda en memoria, V1.1.491) y tarda ~5 s.
-- La política llamaba a get_my_role() una vez POR FILA (~16.500 filas). Con "(select …)" Postgres la calcula
-- una sola vez por consulta. Mismos roles, mismo permiso: solo cambia la velocidad. No toca datos.
-- Vuelta atrás: supabase/rollback/20261016130000_catalogo_politica_rapida.sql
begin;
drop policy if exists catalogo_select on public.catalogo_costos;
create policy catalogo_select on public.catalogo_costos for select to authenticated
  using ((select public.get_my_role()) = any (array['super_admin','admin','administrativo','vendedor']::public.user_role[]));
drop policy if exists catalogo_hist_select on public.catalogo_costos_historial;
create policy catalogo_hist_select on public.catalogo_costos_historial for select to authenticated
  using ((select public.get_my_role()) = any (array['super_admin','admin','administrativo','vendedor']::public.user_role[]));
commit;
