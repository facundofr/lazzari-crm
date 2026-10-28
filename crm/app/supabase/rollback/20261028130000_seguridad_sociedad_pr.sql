-- Vuelta atrás de 20261028130000_seguridad_sociedad_pr.sql: deja las dos funciones exactamente como estaban el 28/10/2026
-- (sin mirar la sociedad del usuario). No toca datos. Los permisos de ejecución no cambian con create or replace.
begin;

create or replace function public.delete_presupuesto_safe(p_presupuesto_id uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_deleted_id uuid;
begin
  if auth.uid() is null or public.get_my_role() is null then
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
$function$;

create or replace function public.change_pr_operator(p_presupuesto_id uuid, p_new_operator_id uuid, p_sociedad_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
DECLARE
  v_role user_role;
BEGIN
  -- Check caller has at least vendedor role
  SELECT role INTO v_role FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_role = 'viewer' THEN
    RAISE EXCEPTION 'No tenés permiso para cambiar el operador';
  END IF;

  -- Update presupuesto
  UPDATE presupuestos
  SET created_by = p_new_operator_id
  WHERE id = p_presupuesto_id
    AND sociedad_id = p_sociedad_id;

  -- Also update linked OCs
  UPDATE ordenes_compra
  SET created_by = p_new_operator_id
  WHERE presupuesto_origen_id = p_presupuesto_id
    AND sociedad_id = p_sociedad_id
    AND estado != 'cancelada';
END;
$function$;

commit;
