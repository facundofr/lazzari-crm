-- Requiere aplicación explícita antes de usar Matchear. No infiere moneda histórica.
begin;
alter table public.extractos_bancarios add column if not exists moneda text
  check (moneda in ('ARS', 'USD'));
alter table public.extracto_movimientos add column if not exists match_movimiento_id uuid
  references public.movimientos(id);
create unique index if not exists extracto_movimientos_match_movimiento_unique
  on public.extracto_movimientos(match_movimiento_id) where match_movimiento_id is not null;

create or replace function public.conciliar_extracto_movimiento(
  p_sociedad_id uuid, p_extracto_id uuid, p_extracto_movimiento_id uuid,
  p_movimiento_id uuid, p_moneda text
) returns void
language plpgsql security invoker set search_path = public
as $$
declare
  v_extracto public.extractos_bancarios%rowtype;
  v_linea public.extracto_movimientos%rowtype;
  v_mov public.movimientos%rowtype;
  v_direction text;
  v_incoming boolean;
  v_outgoing boolean;
begin
  if auth.uid() is null then raise exception 'Sesión requerida'; end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and role::text in ('super_admin', 'admin', 'administrativo')) then
    raise exception 'No tenés permisos para conciliar movimientos';
  end if;
  -- La conciliación requiere asignación explícita incluso si una política
  -- RLS heredada permite lectura global. Nunca se usa service_role.
  if not exists (select 1 from public.user_sociedades where user_id = auth.uid() and sociedad_id = p_sociedad_id) then
    raise exception 'No tenés acceso a esta sociedad';
  end if;
  if p_moneda is null or p_moneda not in ('ARS', 'USD') then raise exception 'Moneda requerida'; end if;
  -- SECURITY INVOKER preserva las políticas RLS y permisos del usuario.
  select * into v_extracto from public.extractos_bancarios
    where id = p_extracto_id and sociedad_id = p_sociedad_id for update;
  if not found then raise exception 'Extracto no disponible en esta sociedad'; end if;
  if v_extracto.moneda is not null and v_extracto.moneda <> p_moneda then raise exception 'Moneda del extracto incompatible'; end if;
  select * into v_linea from public.extracto_movimientos
    where id = p_extracto_movimiento_id and extracto_id = p_extracto_id for update;
  if not found then raise exception 'Movimiento del extracto no disponible'; end if;
  if v_linea.estado::text <> 'pendiente' or v_linea.match_movimiento_id is not null then raise exception 'La línea ya fue conciliada o ignorada'; end if;
  select * into v_mov from public.movimientos
    where id = p_movimiento_id and sociedad_id = p_sociedad_id for update;
  if not found then raise exception 'Movimiento no disponible en esta sociedad'; end if;
  if coalesce(v_mov.conciliado, false) or coalesce(v_mov.anulado, false) then raise exception 'Movimiento ya conciliado o anulado'; end if;
  if v_mov.moneda is null or v_mov.moneda::text <> p_moneda then raise exception 'Las monedas no coinciden'; end if;
  if v_mov.monto is null or v_linea.monto is null or v_mov.monto <= 0 or v_linea.monto <= 0 or round(v_mov.monto::numeric, 2) <> round(v_linea.monto::numeric, 2) then raise exception 'Los importes no coinciden'; end if;
  if v_mov.fecha is null or v_linea.fecha is null or abs(v_mov.fecha::date - v_linea.fecha::date) > 3 then raise exception 'Las fechas difieren más de tres días'; end if;
  v_incoming := v_mov.cliente_id is not null or v_mov.factura_id is not null;
  v_outgoing := v_mov.proveedor_id is not null or v_mov.factura_compra_id is not null;
  v_direction := case
    when v_mov.tipo::text in ('cobro', 'deposito') then 'credito'
    when v_mov.tipo::text in ('pago', 'cheque_emitido') then 'debito'
    when v_mov.tipo::text = 'transferencia' and v_incoming <> v_outgoing then
      case when v_incoming then 'credito' else 'debito' end
    else null end;
  if v_direction is null or v_direction <> v_linea.tipo::text then raise exception 'El sentido del movimiento es incompatible o ambiguo'; end if;

  update public.movimientos set conciliado = true where id = v_mov.id and sociedad_id = p_sociedad_id;
  if not found then raise exception 'No se pudo conciliar el movimiento'; end if;
  update public.extracto_movimientos set estado = 'matcheado', match_movimiento_id = v_mov.id,
    match_cliente_id = v_mov.cliente_id, match_proveedor_id = v_mov.proveedor_id,
    match_factura_id = v_mov.factura_id
    where id = v_linea.id and extracto_id = p_extracto_id;
  if not found then raise exception 'No se pudo guardar la asociación'; end if;
  -- La factura de compra se consulta a través de match_movimiento_id;
  -- match_factura_id apunta exclusivamente a facturas de venta.
  update public.extractos_bancarios set moneda = p_moneda,
    estado = case when exists (
      select 1 from public.extracto_movimientos where extracto_id = p_extracto_id and estado::text = 'pendiente'
    ) then 'parcial'::public.extracto_estado else 'conciliado'::public.extracto_estado end
    where id = p_extracto_id and sociedad_id = p_sociedad_id;
  if not found then raise exception 'No se pudo actualizar el extracto'; end if;
end;
$$;
revoke all on function public.conciliar_extracto_movimiento(uuid, uuid, uuid, uuid, text) from public, anon;
grant execute on function public.conciliar_extracto_movimiento(uuid, uuid, uuid, uuid, text) to authenticated;
commit;
