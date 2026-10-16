-- Vuelta atrás de 20261016180000_presupuestos_editar_todos.sql: el vendedor vuelve a modificar solo los PR que creó él.

drop policy if exists presupuestos_update on public.presupuestos;
create policy presupuestos_update on public.presupuestos
  for update
  using (is_admin_or_above() or get_my_role() = 'administrativo'::user_role or (get_my_role() = 'vendedor'::user_role and created_by = auth.uid()))
  with check (is_admin_or_above() or get_my_role() = 'administrativo'::user_role or (get_my_role() = 'vendedor'::user_role and created_by = auth.uid()));
