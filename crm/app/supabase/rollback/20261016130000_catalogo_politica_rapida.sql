-- Vuelta atrás de 20261016130000_catalogo_politica_rapida.sql: deja las políticas como estaban (get_my_role() por fila).
begin;
drop policy if exists catalogo_select on public.catalogo_costos;
create policy catalogo_select on public.catalogo_costos for select to authenticated
  using (public.get_my_role() = any (array['super_admin','admin','administrativo','vendedor']::public.user_role[]));
drop policy if exists catalogo_hist_select on public.catalogo_costos_historial;
create policy catalogo_hist_select on public.catalogo_costos_historial for select to authenticated
  using (public.get_my_role() = any (array['super_admin','admin','administrativo','vendedor']::public.user_role[]));
commit;
