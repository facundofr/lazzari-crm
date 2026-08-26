-- Permite que vendedores operen el ciclo completo de sus propios presupuestos.
-- La lectura queda compartida para que el equipo vea el estado comercial global.

drop policy if exists presupuestos_select on public.presupuestos;

create policy presupuestos_select
on public.presupuestos
for select
to authenticated
using (
  public.get_my_role() = any (
    array[
      'super_admin'::public.user_role,
      'admin'::public.user_role,
      'vendedor'::public.user_role,
      'administrativo'::public.user_role,
      'viewer'::public.user_role
    ]
  )
);

drop policy if exists presupuestos_update on public.presupuestos;

create policy presupuestos_update
on public.presupuestos
for update
to authenticated
using (
  public.is_admin_or_above()
  or public.get_my_role() = 'administrativo'::public.user_role
  or (
    public.get_my_role() = 'vendedor'::public.user_role
    and created_by = auth.uid()
  )
)
with check (
  public.is_admin_or_above()
  or public.get_my_role() = 'administrativo'::public.user_role
  or (
    public.get_my_role() = 'vendedor'::public.user_role
    and created_by = auth.uid()
  )
);

-- Ventas necesita leer las facturas para mostrar el estado real de cada operación.
-- No concede a vendedores permisos para emitir, modificar o eliminar facturas.
drop policy if exists facturas_select on public.facturas;

create policy facturas_select
on public.facturas
for select
to authenticated
using (
  public.get_my_role() = any (
    array[
      'super_admin'::public.user_role,
      'admin'::public.user_role,
      'vendedor'::public.user_role,
      'administrativo'::public.user_role,
      'viewer'::public.user_role
    ]
  )
);
