-- Cualquier vendedor puede editar cualquier presupuesto (Augusto 16/10/2026: "un PR lo hace Seba y lo tiene que seguir Jero").
-- Antes: el vendedor solo podía modificar los PR que creó él. Los renglones (presupuesto_items) ya los podía guardar
-- cualquiera, así que al editar un PR ajeno se guardaban los renglones pero no el encabezado (sin error, quedaba a medias).
-- Solo cambia la regla de MODIFICAR presupuestos. Ver, crear y borrar quedan igual. No toca datos.
-- Vuelta atrás: supabase/rollback/20261016180000_presupuestos_editar_todos.sql

drop policy if exists presupuestos_update on public.presupuestos;
create policy presupuestos_update on public.presupuestos
  for update
  using (is_admin_or_above() or get_my_role() = any (array['administrativo'::user_role, 'vendedor'::user_role]))
  with check (is_admin_or_above() or get_my_role() = any (array['administrativo'::user_role, 'vendedor'::user_role]));
