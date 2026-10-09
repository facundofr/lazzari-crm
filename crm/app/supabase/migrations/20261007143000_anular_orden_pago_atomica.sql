-- Anulacion atomica de ordenes de pago.
-- Revierte en una sola transaccion movimientos, cheques, saldos a favor y
-- estados de facturas, evitando OPs anuladas a medias desde el navegador.
begin;

create or replace function public.anular_orden_pago_segura(
  p_orden_pago_id uuid,
  p_sociedad_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_op public.ordenes_pago%rowtype;
  v_medio jsonb;
  v_factura_id uuid;
  v_factura_total numeric;
  v_pagado_vigente numeric;
  v_movimientos_anulados integer := 0;
begin
  if auth.uid() is null
    or not exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role in ('super_admin', 'admin', 'administrativo')
    )
    or (
      exists (
        select 1
        from public.user_sociedades us
        where us.user_id = auth.uid()
      )
      and not exists (
        select 1
        from public.user_sociedades us
        where us.user_id = auth.uid()
          and us.sociedad_id = p_sociedad_id
      )
    )
  then
    raise exception 'No tenes permiso para anular ordenes de pago en esta sociedad';
  end if;

  if p_orden_pago_id is null or p_sociedad_id is null then
    raise exception 'La orden de pago y la sociedad son obligatorias';
  end if;

  select * into v_op
  from public.ordenes_pago
  where id = p_orden_pago_id
    and sociedad_id = p_sociedad_id
  for update;

  if not found then
    raise exception 'La orden de pago no existe o no pertenece a la sociedad activa';
  end if;

  if v_op.estado = 'anulada' then
    return jsonb_build_object('ok', true, 'anulada', true, 'replayed', true);
  end if;

  if exists (
    select 1 from public.liquidaciones_fx
    where orden_pago_id = p_orden_pago_id
      and sociedad_id = p_sociedad_id
      and not anulado
  ) then
    raise exception 'Esta OP pertenece a una liquidacion en moneda extranjera. Anula la liquidacion completa.';
  end if;

  -- Una conciliacion bancaria debe deshacerse explicitamente antes de anular.
  if exists (
    select 1 from public.movimientos
    where orden_pago_id = p_orden_pago_id
      and sociedad_id = p_sociedad_id
      and extracto_movimiento_id is not null
      and not coalesce(anulado, false)
  ) then
    raise exception 'Desconcilia primero el movimiento bancario asociado a esta OP';
  end if;

  -- Bloquea las facturas antes de recalcular sus saldos.
  perform 1
  from public.facturas_compra f
  where f.id in (
    select a.factura_compra_id
    from public.op_facturas_compra a
    where a.orden_pago_id = p_orden_pago_id
  )
  order by f.id
  for update;

  update public.movimientos
  set anulado = true,
      monto_original = coalesce(monto_original, monto),
      monto = 0,
      anulado_at = now(),
      anulado_por = auth.uid(),
      conciliado = false,
      descripcion = '[ANULADO] ' || regexp_replace(coalesce(descripcion, ''), '^\[ANULADO\]\s*', '')
  where orden_pago_id = p_orden_pago_id
    and sociedad_id = p_sociedad_id
    and not coalesce(anulado, false);
  get diagnostics v_movimientos_anulados = row_count;

  -- Compatibilidad con OPs historicas cuyos movimientos no tenian orden_pago_id.
  if v_movimientos_anulados = 0 then
    if exists (
      select 1 from public.movimientos
      where sociedad_id = p_sociedad_id
        and proveedor_id = v_op.proveedor_id
        and descripcion like v_op.numero || ' — %'
        and extracto_movimiento_id is not null
        and not coalesce(anulado, false)
    ) then
      raise exception 'Desconcilia primero el movimiento bancario asociado a esta OP';
    end if;

    update public.movimientos
    set anulado = true,
        monto_original = coalesce(monto_original, monto),
        monto = 0,
        anulado_at = now(),
        anulado_por = auth.uid(),
        conciliado = false,
        descripcion = '[ANULADO] ' || regexp_replace(coalesce(descripcion, ''), '^\[ANULADO\]\s*', '')
    where sociedad_id = p_sociedad_id
      and proveedor_id = v_op.proveedor_id
      and descripcion like v_op.numero || ' — %'
      and not coalesce(anulado, false);
    get diagnostics v_movimientos_anulados = row_count;
  end if;

  -- Revierte los cheques reservados o emitidos por la OP.
  if jsonb_typeof(coalesce(v_op.medios_pago, '[]'::jsonb)) = 'array' then
    for v_medio in
      select value from jsonb_array_elements(coalesce(v_op.medios_pago, '[]'::jsonb))
    loop
      if nullif(v_medio->>'echeq_id', '') is null then
        continue;
      end if;

      update public.echeqs
      set estado = case when direccion = 'emitido' then 'pendiente' else 'en_cartera' end,
          destino_tipo = null,
          destino_id = null,
          destino_nombre = null,
          fecha_endoso = null
      where id = (v_medio->>'echeq_id')::uuid
        and sociedad_id = p_sociedad_id
        and estado in ('endosado', 'entregado');
    end loop;
  end if;

  update public.ordenes_pago
  set estado = 'anulada'
  where id = p_orden_pago_id
    and sociedad_id = p_sociedad_id;

  -- El trigger existente anula el saldo a favor de la OP. Recalcular cada
  -- factura contempla otras OPs, pagos directos y notas de credito vigentes.
  for v_factura_id in
    select distinct a.factura_compra_id
    from public.op_facturas_compra a
    where a.orden_pago_id = p_orden_pago_id
  loop
    select f.total,
      coalesce((
        select sum(a.monto)
        from public.op_facturas_compra a
        join public.ordenes_pago op on op.id = a.orden_pago_id
        where a.factura_compra_id = v_factura_id
          and op.sociedad_id = p_sociedad_id
          and op.estado <> 'anulada'
      ), 0)
      + coalesce((
        select sum(coalesce(m.monto, 0) + coalesce(m.retencion_ganancias_monto, 0))
        from public.movimientos m
        where m.factura_compra_id = v_factura_id
          and m.sociedad_id = p_sociedad_id
          and m.tipo::text = 'pago'
          and not coalesce(m.anulado, false)
      ), 0)
      + coalesce(f.total_acreditado, 0)
    into v_factura_total, v_pagado_vigente
    from public.facturas_compra f
    where f.id = v_factura_id
      and f.sociedad_id = p_sociedad_id;

    if found then
      update public.facturas_compra
      set estado = case
        when v_pagado_vigente >= v_factura_total - 0.005 then 'pagada'
        else 'pendiente'
      end
      where id = v_factura_id
        and sociedad_id = p_sociedad_id
        and estado not in ('anulada', 'pendiente_aprobacion');
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'anulada', true,
    'replayed', false,
    'movimientos_anulados', v_movimientos_anulados
  );
end;
$$;

revoke all on function public.anular_orden_pago_segura(uuid, uuid) from public, anon;
grant execute on function public.anular_orden_pago_segura(uuid, uuid) to authenticated;

commit;
