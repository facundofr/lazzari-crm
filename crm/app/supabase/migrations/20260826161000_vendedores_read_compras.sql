-- Los vendedores necesitan visibilidad de Compras para seguir el estado de
-- las ordenes asociadas a las ventas. No se amplian permisos de escritura.
drop policy if exists ordenes_compra_select_crm on public.ordenes_compra;

create policy ordenes_compra_select_crm
on public.ordenes_compra
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

drop policy if exists orden_compra_items_select_crm on public.orden_compra_items;

create policy orden_compra_items_select_crm
on public.orden_compra_items
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
