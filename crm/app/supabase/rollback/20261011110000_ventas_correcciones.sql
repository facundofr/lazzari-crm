-- Deshace 20261011110000_ventas_correcciones.sql.
-- Las NC ya grabadas con la función nueva NO se borran (son comprobantes válidos).
-- Las columnas e índice de facturas vienen de 20261008120000 y no se tocan.
begin;

drop function if exists public.crear_nota_credito_manual_venta(
  uuid, uuid, uuid, text, integer, integer, date, numeric, numeric, numeric, jsonb, text, text, boolean
);

-- delete_manual_invoice vuelve a la versión de 20260831123000 (solo rol, sin chequeo de sociedad).
create or replace function public.delete_manual_invoice(p_factura_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_factura public.facturas%rowtype;
  v_role public.user_role;
begin
  v_role := public.get_my_role();
  if v_role not in (
    'super_admin'::public.user_role,
    'admin'::public.user_role,
    'administrativo'::public.user_role
  ) then
    raise exception 'No tenés permiso para eliminar facturas manuales';
  end if;

  select * into v_factura
  from public.facturas
  where id = p_factura_id
  for update;

  if not found then
    raise exception 'La factura no existe';
  end if;

  if v_factura.cae is not null then
    raise exception 'Una factura autorizada por ARCA no se puede eliminar';
  end if;

  if v_factura.estado::text <> 'anulada' then
    raise exception 'Primero tenés que anular la factura manual';
  end if;

  if exists (select 1 from public.movimientos where factura_id = p_factura_id) then
    raise exception 'La factura tiene movimientos asociados y no se puede eliminar';
  end if;

  if exists (select 1 from public.remitos where factura_id = p_factura_id) then
    raise exception 'La factura tiene remitos asociados y no se puede eliminar';
  end if;

  if exists (select 1 from public.facturas where factura_origen_id = p_factura_id) then
    raise exception 'La factura tiene notas de crédito asociadas y no se puede eliminar';
  end if;

  delete from public.factura_items where factura_id = p_factura_id;
  delete from public.facturas where id = p_factura_id;
end;
$$;

revoke all on function public.delete_manual_invoice(uuid) from public;
grant execute on function public.delete_manual_invoice(uuid) to authenticated;

commit;
