-- Elimina un presupuesto de forma atomica y evita falsos positivos por RLS.
-- La politica DELETE directa permanece restrictiva: la aplicacion usa esta RPC.
create or replace function public.delete_presupuesto_safe(p_presupuesto_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted_id uuid;
begin
  if auth.uid() is null or not public.is_admin_or_above() then
    raise exception 'No tenes permisos para eliminar presupuestos' using errcode = '42501';
  end if;

  if exists (select 1 from public.facturas where presupuesto_id = p_presupuesto_id) then
    raise exception 'El presupuesto tiene facturas asociadas';
  end if;

  if exists (select 1 from public.remitos where presupuesto_id = p_presupuesto_id) then
    raise exception 'El presupuesto tiene remitos asociados';
  end if;

  if exists (select 1 from public.ordenes_compra where presupuesto_origen_id = p_presupuesto_id) then
    raise exception 'El presupuesto tiene ordenes de compra asociadas';
  end if;

  delete from public.eventos where presupuesto_id = p_presupuesto_id;
  delete from public.pendientes where presupuesto_id = p_presupuesto_id;
  delete from public.fichas_relevamiento where presupuesto_id = p_presupuesto_id;
  delete from public.notas_credito where presupuesto_id = p_presupuesto_id;
  delete from public.presupuesto_items where presupuesto_id = p_presupuesto_id;

  delete from public.presupuestos
  where id = p_presupuesto_id
  returning id into v_deleted_id;

  if v_deleted_id is null then
    raise exception 'El presupuesto no existe o ya fue eliminado';
  end if;

  return v_deleted_id;
end;
$$;

revoke all on function public.delete_presupuesto_safe(uuid) from public;
grant execute on function public.delete_presupuesto_safe(uuid) to authenticated;
