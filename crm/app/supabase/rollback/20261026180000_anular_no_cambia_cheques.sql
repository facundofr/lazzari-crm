-- Vuelta atrás de 20261026180000_anular_no_cambia_cheques.sql: las dos funciones vuelven a como estaban en la base el 26/10/2026
-- (anular una OP devuelve sus cheques elegidos a pendiente / en cartera; anular un cobro anula sus cheques en cartera).
-- Los cheques no se tocan.
begin;

CREATE OR REPLACE FUNCTION public.anular_orden_pago_segura(p_orden_pago_id uuid, p_sociedad_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_op public.ordenes_pago%rowtype;
  v_medio jsonb;
  v_factura_id uuid;
  v_factura_total numeric;
  v_pagado_vigente numeric;
  v_movimientos_anulados integer := 0;
  v_nc record;
  v_nc_revertidas integer := 0;
  v_items_plan integer := 0;
  v_lotes uuid[];
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

  -- Bloquea las facturas (y las NC usadas en la OP) antes de recalcular sus saldos.
  perform 1
  from public.facturas_compra f
  where f.id in (
    select a.factura_compra_id
    from public.op_facturas_compra a
    where a.orden_pago_id = p_orden_pago_id
    union
    select o.factura_compra_id
    from public.op_notas_credito_compra o
    where o.orden_pago_id = p_orden_pago_id
    union
    select o.nota_credito_compra_id
    from public.op_notas_credito_compra o
    where o.orden_pago_id = p_orden_pago_id
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

  -- NC aplicadas en esta misma OP: se revierten y vuelven a quedar disponibles.
  -- (Si la NC ya se había anulado aparte, su movimiento ya está anulado y se saltea.)
  for v_nc in
    select o.nota_credito_compra_id, o.factura_compra_id, m.id as movimiento_id, coalesce(m.monto, 0) as monto
    from public.op_notas_credito_compra o
    join public.movimientos m on m.id = o.movimiento_id
    where o.orden_pago_id = p_orden_pago_id
      and o.sociedad_id = p_sociedad_id
      and not coalesce(m.anulado, false)
    order by o.factura_compra_id, o.id
  loop
    update public.movimientos
    set anulado = true,
        monto_original = coalesce(monto_original, monto),
        monto = 0,
        anulado_at = now(),
        anulado_por = auth.uid(),
        descripcion = '[ANULADO] ' || regexp_replace(coalesce(descripcion, ''), '^\[ANULADO\]\s*', '')
    where id = v_nc.movimiento_id;

    update public.facturas_compra
    set total_acreditado = greatest(0, round(coalesce(total_acreditado, 0) - v_nc.monto, 2))
    where id = v_nc.factura_compra_id
      and sociedad_id = p_sociedad_id;

    update public.facturas_compra
    set credito_aplicado = greatest(0, round(coalesce(credito_aplicado, 0) - v_nc.monto, 2))
    where id = v_nc.nota_credito_compra_id
      and sociedad_id = p_sociedad_id;

    v_nc_revertidas := v_nc_revertidas + 1;
  end loop;

  -- Si la OP salió de un Plan de pagos, el renglón vuelve a "pendiente" con una clave nueva
  -- (la anterior ya quedó usada por la OP anulada) para poder registrar el pago de nuevo.
  with reabiertos as (
    update public.pagos_lote_items
    set estado = 'pendiente',
        orden_pago_id = null,
        fecha_pago = null,
        request_key = gen_random_uuid(),
        error = 'La OP ' || coalesce(v_op.numero, '') || ' se anuló: volvé a registrar este pago.'
    where orden_pago_id = p_orden_pago_id
      and sociedad_id = p_sociedad_id
      and estado = 'pagado'
    returning lote_id
  )
  select count(*), array_agg(distinct lote_id) into v_items_plan, v_lotes from reabiertos;

  if v_items_plan > 0 then
    update public.pagos_lotes
    set estado = 'en_banco'
    where id = any(v_lotes)
      and sociedad_id = p_sociedad_id
      and estado = 'cerrado';
  end if;

  -- El trigger existente anula el saldo a favor de la OP. Recalcular cada
  -- factura contempla otras OPs, pagos directos y notas de credito vigentes,
  -- contando el credito de cada NC una sola vez (public.fc_compra_pagado).
  for v_factura_id in
    select a.factura_compra_id
    from public.op_facturas_compra a
    where a.orden_pago_id = p_orden_pago_id
    union
    select o.factura_compra_id
    from public.op_notas_credito_compra o
    where o.orden_pago_id = p_orden_pago_id
      and o.sociedad_id = p_sociedad_id
  loop
    select f.total, public.fc_compra_pagado(f.id, p_sociedad_id)
    into v_factura_total, v_pagado_vigente
    from public.facturas_compra f
    where f.id = v_factura_id
      and f.sociedad_id = p_sociedad_id;

    if found then
      update public.facturas_compra
      set estado = case
        when v_pagado_vigente >= v_factura_total - 0.005 then 'pagada'
        when estado = 'pagada' then 'pendiente'
        else estado
      end
      where id = v_factura_id
        and sociedad_id = p_sociedad_id
        and estado not in ('anulada', 'pendiente_aprobacion', 'en_conciliacion');
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'anulada', true,
    'replayed', false,
    'movimientos_anulados', v_movimientos_anulados,
    'notas_credito_revertidas', v_nc_revertidas,
    'items_plan_reabiertos', v_items_plan
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.gestionar_cobro(p_movimiento_id uuid, p_accion text, p_descripcion text DEFAULT NULL::text, p_monto numeric DEFAULT NULL::numeric, p_moneda text DEFAULT NULL::text, p_fecha date DEFAULT NULL::date, p_tipo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_mov public.movimientos%rowtype;
  v_facturas uuid[] := array[]::uuid[];
  v_facturas_aplicadas uuid[] := array[]::uuid[];
  v_factura_id uuid;
  v_aplicaciones integer := 0;
  v_cobrado numeric := 0;
  v_total numeric := 0;
  v_acreditado numeric := 0;
  v_es_admin boolean := false;
  v_cheques uuid[] := array[]::uuid[];
  v_echeq record;
  v_cheques_anulados integer := 0;
  v_avisos jsonb := '[]'::jsonb;
  v_hoy text := to_char(now() at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY');
begin
  if auth.uid() is null then
    raise exception 'Sesión no válida';
  end if;

  select * into v_mov
  from public.movimientos
  where id = p_movimiento_id
  for update;

  if not found then
    raise exception 'El cobro ya no existe';
  end if;

  -- A9b: hace falta el rol Y pertenecer a la sociedad del movimiento.
  if not public.lz_puede_operar_finanzas(v_mov.sociedad_id) then
    raise exception 'No tenés permiso para operar este cobro' using errcode = '42501';
  end if;

  v_es_admin := exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role::text in ('super_admin', 'admin')
  );

  if v_mov.factura_id is not null then
    v_facturas := array_append(v_facturas, v_mov.factura_id);
  end if;

  select coalesce(array_agg(distinct factura_id), array[]::uuid[]), count(*)
    into v_facturas_aplicadas, v_aplicaciones
  from public.cobro_aplicaciones
  where movimiento_id = p_movimiento_id;
  v_facturas := v_facturas || v_facturas_aplicadas;

  case p_accion
    when 'editar' then
      if v_mov.anulado then
        raise exception 'Un cobro anulado no se puede editar';
      end if;
      if coalesce(p_monto, v_mov.monto) <= 0 then
        raise exception 'El monto debe ser mayor a cero';
      end if;
      if v_aplicaciones > 1 and p_monto is distinct from v_mov.monto then
        raise exception 'Este cobro está distribuido entre varias facturas; el monto no puede modificarse desde una sola línea';
      end if;

      update public.movimientos
      set descripcion = coalesce(nullif(trim(p_descripcion), ''), descripcion),
          monto = coalesce(p_monto, monto),
          moneda = coalesce(nullif(p_moneda, '')::public.moneda_type, moneda),
          fecha = coalesce(p_fecha, fecha),
          tipo = coalesce(nullif(p_tipo, '')::public.movimiento_tipo, tipo)
      where id = p_movimiento_id;

      if v_aplicaciones = 1 and p_monto is not null then
        update public.cobro_aplicaciones set monto = p_monto where movimiento_id = p_movimiento_id;
      end if;

    when 'anular', 'eliminar' then
      if p_accion = 'eliminar' and not v_es_admin then
        raise exception 'Solo un administrador puede borrar un movimiento. Usá «Anular»: conserva el registro y recalcula la factura.' using errcode = '42501';
      end if;
      if p_accion = 'anular' and v_mov.anulado then
        raise exception 'El cobro ya está anulado';
      end if;

      -- A6b: el cheque que generó este cobro deja de estar disponible.
      v_cheques := public.lz_echeqs_de_movimiento(p_movimiento_id);
      for v_echeq in
        select e.id, e.numero, e.estado from public.echeqs e
        where e.id = any (v_cheques)
        for update
      loop
        if v_echeq.estado in ('en_cartera', 'pendiente', 'vencido') then
          update public.echeqs
          set estado = 'anulado',
              movimiento_id = case when p_accion = 'eliminar' then null else p_movimiento_id end,
              observaciones = concat_ws(' | ', nullif(observaciones, ''), '[Anulado ' || v_hoy || '] se anuló el cobro')
          where id = v_echeq.id;
          v_cheques_anulados := v_cheques_anulados + 1;
        elsif v_echeq.estado not in ('anulado', 'rechazado') then
          update public.echeqs set movimiento_id = case when p_accion = 'eliminar' then null else p_movimiento_id end
          where id = v_echeq.id and movimiento_id is null;
          v_avisos := v_avisos || to_jsonb('El cheque ' || coalesce(v_echeq.numero, '') || ' ya está ' || v_echeq.estado || ': revisalo a mano.');
        end if;
      end loop;

      if v_aplicaciones > 0 then
        delete from public.cobro_aplicaciones where movimiento_id = p_movimiento_id;
      end if;

      if p_accion = 'anular' then
        update public.movimientos
        set anulado = true,
            monto_original = monto,
            monto = 0,
            anulado_at = now(),
            anulado_por = auth.uid(),
            conciliado = false,
            descripcion = '[ANULADO] ' || regexp_replace(descripcion, '^\[ANULADO\]\s*', '')
        where id = p_movimiento_id;
      else
        delete from public.movimientos where id = p_movimiento_id;
      end if;

    else
      raise exception 'Acción inválida';
  end case;

  foreach v_factura_id in array v_facturas loop
    select total, coalesce(total_acreditado, 0)
      into v_total, v_acreditado
    from public.facturas
    where id = v_factura_id;

    if found then
      -- Cobros directos (sin aplicaciones, para no contarlos dos veces) + aplicaciones vigentes.
      select coalesce(sum(m.monto), 0)
        into v_cobrado
      from public.movimientos m
      where m.factura_id = v_factura_id
        and not coalesce(m.anulado, false)
        and not exists (select 1 from public.cobro_aplicaciones ca where ca.movimiento_id = m.id);

      v_cobrado := v_cobrado + coalesce((
        select sum(ca.monto)
        from public.cobro_aplicaciones ca
        join public.movimientos m on m.id = ca.movimiento_id
        where ca.factura_id = v_factura_id and not coalesce(m.anulado, false)
      ), 0);

      update public.facturas
      set estado = case
        when estado = 'anulada' then estado
        when v_cobrado + v_acreditado >= v_total - 0.01 then 'pagada'::public.factura_status
        when v_cobrado + v_acreditado > 0 then 'parcial'::public.factura_status
        else 'emitida'::public.factura_status
      end
      where id = v_factura_id;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'accion', p_accion,
    'movimiento_id', p_movimiento_id,
    'facturas', to_jsonb(v_facturas),
    'cheques_anulados', v_cheques_anulados,
    'avisos', v_avisos
  );
end;
$function$;


revoke all on function public.anular_orden_pago_segura(uuid, uuid) from public, anon;
grant execute on function public.anular_orden_pago_segura(uuid, uuid) to authenticated;
revoke all on function public.gestionar_cobro(uuid, text, text, numeric, text, date, text) from public, anon;
grant execute on function public.gestionar_cobro(uuid, text, text, numeric, text, date, text) to authenticated;

commit;
