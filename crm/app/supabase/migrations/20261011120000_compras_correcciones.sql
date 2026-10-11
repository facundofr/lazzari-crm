-- Correcciones del circuito de compras y pagos (DIAGNOSTICO-FINANCIERO.md: A2, A4, C1, C2, C3).
--
-- Cambios ADITIVOS: no borra ni modifica datos existentes; solo redefine funciones.
--  1. public.fc_compra_pagado: un solo cálculo de lo cancelado de una factura de compra
--     (OP vigentes + pagos directos + crédito de NC contado UNA sola vez: el mayor entre
--     total_acreditado y los movimientos de NC). Misma regla que Finanzas.
--  2. A2 · anular_orden_pago_segura: deja de contar dos veces la NC; además revierte las NC
--     usadas en esa misma OP y vuelve a "pendiente" el renglón del Plan de pagos.
--  3. A4 · fx_documento_pagado / liquidar_documentos_fx: el saldo en dólares ya no resta dos veces la NC.
--  4. C3 · registrar_pago_proveedor_seguro: el pago directo puede cancelar la factura completa
--     (sigue sin permitir pagar de más) y en ese caso la marca pagada.
--  5. C1/C2 · guardar_conciliacion_compra: el duplicado compara también el tipo de comprobante
--     y no cuenta anuladas; el exceso sobre la OC es un AVISO (p_confirmar) y no cuenta
--     asignaciones de facturas anuladas. La vista orden_compra_items_pendientes tampoco las cuenta.
--
-- Correr entera en el SQL Editor de Supabase. Se puede volver a correr sin problema.
-- Para deshacer: supabase/rollback/20261011120000_compras_correcciones.sql

begin;

-- 1) Cálculo único de lo cancelado de una factura de compra
create or replace function public.fc_compra_pagado(p_factura_id uuid, p_sociedad_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  -- Lo cancelado de una factura de compra, con la misma regla que Finanzas y lib/saldo-proveedores.ts:
  --   OP vigentes + pagos directos (con su retención) + crédito de NC contado UNA sola vez.
  -- Una NC deja dos rastros del mismo crédito (facturas_compra.total_acreditado y un movimiento
  -- tipo 'pago' con nota_credito_compra_id): se toma el mayor, nunca la suma.
  select
    coalesce((
      select sum(a.monto)
      from public.op_facturas_compra a
      join public.ordenes_pago op on op.id = a.orden_pago_id
      where a.factura_compra_id = p_factura_id
        and op.sociedad_id = p_sociedad_id
        and op.estado <> 'anulada'
    ), 0)
    + coalesce((
      select sum(coalesce(m.monto, 0) + coalesce(m.retencion_ganancias_monto, 0))
      from public.movimientos m
      where m.factura_compra_id = p_factura_id
        and m.sociedad_id = p_sociedad_id
        and m.tipo::text = 'pago'
        and m.nota_credito_compra_id is null
        and not coalesce(m.anulado, false)
    ), 0)
    + greatest(
      coalesce((
        select f.total_acreditado
        from public.facturas_compra f
        where f.id = p_factura_id
      ), 0),
      coalesce((
        select sum(coalesce(m.monto, 0))
        from public.movimientos m
        where m.factura_compra_id = p_factura_id
          and m.sociedad_id = p_sociedad_id
          and m.tipo::text = 'pago'
          and m.nota_credito_compra_id is not null
          and not coalesce(m.anulado, false)
      ), 0)
    );
$$;

-- Uso interno (lo llaman las funciones security definer); no se expone a la API.
revoke all on function public.fc_compra_pagado(uuid, uuid) from public, anon, authenticated;

-- 2) A2 · Anular orden de pago
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
$$;

revoke all on function public.anular_orden_pago_segura(uuid, uuid) from public, anon;
grant execute on function public.anular_orden_pago_segura(uuid, uuid) to authenticated;

-- 3) A4 · Liquidaciones en moneda extranjera
create or replace function public.fx_documento_pagado(p_kind text,p_id uuid,p_soc uuid)
returns numeric language plpgsql security definer set search_path=public as $$
declare v_paid numeric; v_other numeric; v_currency text;
begin
 if p_kind='cobro' then
  select moneda::text into v_currency from facturas where id=p_id and sociedad_id=p_soc;
  -- Refuse legacy ambiguous ARS amounts instead of silently subtracting pesos from USD.
  if exists(select 1 from movimientos where factura_id=p_id and sociedad_id=p_soc and not coalesce(anulado,false) and moneda::text<>v_currency and monto<>0)
    or exists(select 1 from cobro_aplicaciones a join movimientos m on m.id=a.movimiento_id where a.factura_id=p_id and m.sociedad_id=p_soc and not coalesce(m.anulado,false) and m.moneda::text<>v_currency and m.liquidacion_fx_id is null) then
   raise exception 'La factura tiene cobros históricos en otra moneda sin conciliación; revisar antes de continuar';
  end if;
  select coalesce(sum(monto),0) into v_paid from movimientos where factura_id=p_id and sociedad_id=p_soc and not coalesce(anulado,false);
  select coalesce(sum(a.monto),0) into v_other from cobro_aplicaciones a join movimientos m on m.id=a.movimiento_id
   where a.factura_id=p_id and m.sociedad_id=p_soc and not coalesce(m.anulado,false);
 else
  select moneda::text into v_currency from facturas_compra where id=p_id and sociedad_id=p_soc;
  if exists(select 1 from movimientos where factura_compra_id=p_id and sociedad_id=p_soc and tipo::text='pago' and not coalesce(anulado,false) and moneda::text<>v_currency and monto<>0) then
   raise exception 'La factura tiene pagos históricos en otra moneda sin conciliación; revisar antes de continuar';
  end if;
  -- Compras: pagos directos + OP vigentes + credito de NC contado una sola vez
  -- (mayor entre total_acreditado y los movimientos de la NC; nunca la suma).
  v_paid:=public.fc_compra_pagado(p_id,p_soc);
  v_other:=0;
 end if;
 return v_paid+v_other;
end $$;
revoke all on function public.fx_documento_pagado(text,uuid,uuid) from public,anon,authenticated;

create or replace function public.liquidar_documentos_fx(
 p_sociedad_id uuid,p_request_key uuid,p_kind text,p_counterparty_id uuid,p_fecha date,
 p_cotizacion numeric,p_cotizacion_fecha date,p_modalidad text,p_documentos jsonb,p_medios jsonb,p_retenciones jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
 v_id uuid; v_existing liquidaciones_fx%rowtype; v_payload jsonb;
 d jsonb; line jsonb; f jsonb; v_doc uuid; v_usd numeric; v_ars numeric;
 v_bruto numeric:=0; v_neto numeric:=0; v_ret numeric:=0; v_gan numeric:=0; v_base numeric:=0;
 v_saldo numeric; v_tc_original numeric; v_mov uuid; v_anchor uuid; v_op uuid; v_num text;
 v_today date:=(now() at time zone 'America/Argentina/Buenos_Aires')::date;
begin
 if auth.uid() is null or not exists(select 1 from profiles where id=auth.uid() and role in ('super_admin','admin','administrativo'))
  or (
   exists(select 1 from user_sociedades where user_id=auth.uid())
   and not exists(select 1 from user_sociedades where user_id=auth.uid() and sociedad_id=p_sociedad_id)
  ) then
  raise exception 'No tenés permiso para operar esta sociedad';
 end if;
 if p_request_key is null or p_counterparty_id is null or p_kind is null or p_kind not in ('cobro','pago')
  or p_cotizacion is null or p_cotizacion<=0 or p_cotizacion>100000000 or p_cotizacion<>round(p_cotizacion,6)
  or p_fecha is null or p_fecha>v_today or p_cotizacion_fecha is null or p_cotizacion_fecha>p_fecha
  or p_modalidad is null or p_modalidad not in ('divisas','billetes','manual') then raise exception 'Datos de liquidación o cotización inválidos'; end if;
 if jsonb_typeof(p_documentos) is distinct from 'array' or jsonb_array_length(p_documentos)=0 or jsonb_array_length(p_documentos)>100
  or jsonb_typeof(p_medios) is distinct from 'array' or jsonb_array_length(p_medios)=0
  or jsonb_typeof(p_retenciones) is distinct from 'array' then raise exception 'Documentos y medios requeridos'; end if;
 if (select count(*)<>count(distinct x->>'id') from jsonb_array_elements(p_documentos) x) then raise exception 'Documento duplicado'; end if;
 v_payload:=jsonb_build_object('kind',p_kind,'counterparty',p_counterparty_id,'fecha',p_fecha,'tc',p_cotizacion,'tc_fecha',p_cotizacion_fecha,'modalidad',p_modalidad,'documentos',p_documentos,'medios',p_medios,'retenciones',p_retenciones);
 -- Serializes retries and monthly payment bases for this party within this company.
 perform pg_advisory_xact_lock(hashtextextended(p_sociedad_id::text||p_counterparty_id::text,0));
 select * into v_existing from liquidaciones_fx where sociedad_id=p_sociedad_id and request_key=p_request_key;
 if found then
  if v_existing.payload<>v_payload or v_existing.created_by<>auth.uid() then raise exception 'La solicitud ya existe con otros datos'; end if;
  return jsonb_build_object('id',v_existing.id,'orden_pago_id',v_existing.orden_pago_id,'anulado',v_existing.anulado,'replayed',true);
 end if;
 -- Validate all lines before changing any balance.
 for line in select value from jsonb_array_elements(p_medios) loop
  if coalesce(line->>'tipo','') not in ('transferencia','efectivo','deposito','cheque_recibido') or coalesce((line->>'monto')::numeric,0)<=0
   or (line->>'monto')::numeric<>round((line->>'monto')::numeric,2) or coalesce((line->>'fecha')::date,p_fecha)<>p_fecha then
   raise exception 'Medio inválido: use importes ARS positivos y la fecha de esta liquidación'; end if;
  v_neto:=v_neto+(line->>'monto')::numeric;
 end loop;
 for line in select value from jsonb_array_elements(p_retenciones) loop
  if coalesce(line->>'tipo','') not in ('retencion_iva','retencion_ganancias','retencion_iibb','retencion_suss')
   or coalesce((line->>'monto')::numeric,0)<=0 or (line->>'monto')::numeric<>round((line->>'monto')::numeric,2)
   or coalesce(trim(line->>'certificado'),'')='' then raise exception 'Retención inválida: importe ARS y certificado requeridos'; end if;
  v_ret:=v_ret+(line->>'monto')::numeric;
  if line->>'tipo'='retencion_ganancias' then v_gan:=v_gan+(line->>'monto')::numeric; end if;
 end loop;
 insert into liquidaciones_fx(sociedad_id,request_key,created_by,kind,counterparty_id,fecha,cotizacion,cotizacion_fecha,modalidad,payload)
 values(p_sociedad_id,p_request_key,auth.uid(),p_kind,p_counterparty_id,p_fecha,p_cotizacion,p_cotizacion_fecha,p_modalidad,v_payload) returning id into v_id;
 for d in select value from jsonb_array_elements(p_documentos) order by value->>'id' loop
  v_doc:=(d->>'id')::uuid; v_usd:=(d->>'monto_usd')::numeric;
  if v_usd is null or v_usd<=0 or v_usd<>round(v_usd,2) then raise exception 'Importe USD inválido'; end if;
  f:=null;
  if p_kind='cobro' then
   select to_jsonb(t) into f from facturas t where id=v_doc and sociedad_id=p_sociedad_id and cliente_id=p_counterparty_id for update;
  else
   select to_jsonb(t) into f from facturas_compra t where id=v_doc and sociedad_id=p_sociedad_id and proveedor_id=p_counterparty_id for update;
  end if;
  if f is null or f->>'moneda'<>'USD' or f->>'estado' in ('anulada','borrador','pendiente_aprobacion') then raise exception 'Factura inexistente, no aprobada, anulada o de otra moneda/sociedad'; end if;
  if p_kind='cobro' and (coalesce(f->>'tipo','') like 'NC%' or f->>'tipo' in ('203','208','213')) then raise exception 'No se puede cobrar una nota de crédito'; end if;
  if p_fecha<(f->>'fecha')::date then raise exception 'La liquidación no puede ser anterior a la factura'; end if;
  -- En compras fx_documento_pagado ya incluye el credito de NC: no se vuelve a restar total_acreditado.
  v_saldo:=(f->>'total')::numeric-case when p_kind='cobro' then coalesce((f->>'total_acreditado')::numeric,0) else 0 end-fx_documento_pagado(p_kind,v_doc,p_sociedad_id);
  if v_usd>round(v_saldo,2) then raise exception 'El importe supera el saldo actual de la factura. Actualizá la liquidación'; end if;
  v_ars:=round(v_usd*p_cotizacion,2);
  if v_ars<=0 then raise exception 'Importe convertido menor a un centavo'; end if;
  v_bruto:=v_bruto+v_ars;
  v_base:=v_base+round(v_ars*coalesce((f->>'subtotal')::numeric,0)/nullif((f->>'total')::numeric,0),2);
  v_tc_original:=coalesce(nullif(f->>'cotizacion','')::numeric,nullif(f->>'tipo_cambio','')::numeric);
  if v_tc_original<=0 then v_tc_original:=null; end if;
  insert into aplicaciones_fx(liquidacion_id,documento_id,monto_usd,monto_ars,cotizacion_original,diferencia_cambio_ars,estado_previo)
  values(v_id,v_doc,v_usd,v_ars,v_tc_original,case when v_tc_original is null then null else round(v_usd*(p_cotizacion-v_tc_original),2) end,f->>'estado');
 end loop;
 if v_bruto<>v_neto+v_ret then raise exception 'Los pesos y retenciones no coinciden con los dólares a cancelar por la cotización'; end if;
 perform set_config('app.fx_anular',v_id::text,true);
 if p_kind='pago' then
  v_num:='OP-FX-'||v_id::text;
  insert into ordenes_pago(numero,fecha,proveedor_id,monto_bruto,base_retencion_ganancias,retencion_ganancias_monto,neto_a_pagar,moneda,medio_pago,medios_pago,estado,sociedad_id,created_by,notas)
  values(v_num,p_fecha,p_counterparty_id,v_bruto,v_base,v_gan,v_neto,'ARS',p_medios->0->>'tipo',p_medios,'pagada',p_sociedad_id,auth.uid(),'Liquidación USD/ARS. Retenciones ingresadas según certificados. TC '||p_cotizacion||' del '||p_cotizacion_fecha)
  returning id into v_op;
  update liquidaciones_fx set orden_pago_id=v_op where id=v_id;
  insert into op_facturas_compra(orden_pago_id,factura_compra_id,monto)
   select v_op,documento_id,monto_usd from aplicaciones_fx where liquidacion_id=v_id;
 end if;
 for line in select value from jsonb_array_elements(p_medios||p_retenciones) loop
  insert into movimientos(tipo,cliente_id,proveedor_id,monto,moneda,fecha,descripcion,conciliado,sociedad_id,created_by,liquidacion_fx_id)
  values((case when left(line->>'tipo',10)='retencion_' then line->>'tipo' when p_kind='pago' then 'pago' else 'cobro' end)::public.movimiento_tipo,
   case when p_kind='cobro' then p_counterparty_id end,case when p_kind='pago' then p_counterparty_id end,
   (line->>'monto')::numeric,'ARS',p_fecha,coalesce(v_num,'Cobro FX')||' — '||(line->>'tipo')||' '||coalesce(line->>'referencia',line->>'certificado','')||' | TC '||p_cotizacion||' del '||p_cotizacion_fecha,
   false,p_sociedad_id,auth.uid(),v_id) returning id into v_mov;
  if v_anchor is null then v_anchor:=v_mov; end if;
 end loop;
 -- One anchor per settlement: applications already include retentions, never sum them twice.
 if p_kind='cobro' then
  insert into cobro_aplicaciones(movimiento_id,factura_id,monto)
   select v_anchor,documento_id,monto_usd from aplicaciones_fx where liquidacion_id=v_id;
 end if;
 for d in select to_jsonb(a) from aplicaciones_fx a where liquidacion_id=v_id loop
  v_doc:=(d->>'documento_id')::uuid;
  if p_kind='cobro' then
   update facturas set estado=case when total-coalesce(total_acreditado,0)-fx_documento_pagado('cobro',id,p_sociedad_id)<=0.005 then 'pagada'::public.factura_status else 'parcial'::public.factura_status end where id=v_doc and sociedad_id=p_sociedad_id;
  else
   update facturas_compra set estado='pagada' where id=v_doc and sociedad_id=p_sociedad_id and total-fx_documento_pagado('pago',id,p_sociedad_id)<=0.005;
  end if;
 end loop;
 perform set_config('app.fx_anular','',true);
 return jsonb_build_object('id',v_id,'orden_pago_id',v_op,'bruto_ars',v_bruto,'neto_ars',v_neto,'retenciones_ars',v_ret);
end $$;
revoke all on function public.liquidar_documentos_fx(uuid,uuid,text,uuid,date,numeric,date,text,jsonb,jsonb,jsonb) from public,anon;
grant execute on function public.liquidar_documentos_fx(uuid,uuid,text,uuid,date,numeric,date,text,jsonb,jsonb,jsonb) to authenticated;

-- 4) C3 · Pago directo total permitido
create or replace function public.registrar_pago_proveedor_seguro(
  p_sociedad_id uuid,
  p_request_key uuid,
  p_modo text,
  p_proveedor_id uuid,
  p_fecha date,
  p_moneda text,
  p_facturas jsonb,
  p_medios jsonb,
  p_monto_bruto numeric,
  p_base_retencion numeric,
  p_retencion_pct numeric,
  p_retencion_monto numeric,
  p_notas text default null,
  p_sobre_verde boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.pago_solicitudes%rowtype;
  v_payload jsonb;
  v_result jsonb;
  v_proveedor_nombre text;
  v_factura jsonb;
  v_item jsonb;
  v_medio jsonb;
  v_ordinal bigint;
  v_factura_id uuid;
  v_aplicar numeric;
  v_pagado_directo numeric;
  v_pagado_op numeric;
  v_saldo numeric;
  v_documentos_total numeric := 0;
  v_total_medios numeric := 0;
  v_neto_esperado numeric;
  v_saldo_favor numeric := 0;
  v_op_id uuid;
  v_op_numero text;
  v_movimiento_id uuid;
  v_echeq jsonb;
  v_numero_cheque text;
  v_today date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
begin
  if auth.uid() is null
    or not exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('super_admin', 'admin', 'administrativo')
    )
    or (
      exists (
        select 1 from public.user_sociedades us
        where us.user_id = auth.uid()
      )
      and not exists (
        select 1 from public.user_sociedades us
        where us.user_id = auth.uid()
          and us.sociedad_id = p_sociedad_id
      )
    ) then
    raise exception 'No tenes permiso para pagar en esta sociedad';
  end if;

  if p_request_key is null
    or p_sociedad_id is null
    or p_proveedor_id is null
    or p_modo is null
    or p_modo not in ('directo', 'op')
    or p_fecha is null
    or p_fecha > v_today
    or p_moneda is null
    or p_moneda <> 'ARS'
    or jsonb_typeof(p_facturas) is distinct from 'array'
    or jsonb_typeof(p_medios) is distinct from 'array'
    or jsonb_array_length(p_medios) = 0
    or p_monto_bruto is null
    or p_monto_bruto <= 0
    or p_monto_bruto <> round(p_monto_bruto, 2)
    or coalesce(p_base_retencion, 0) < 0
    or coalesce(p_base_retencion, 0) <> round(coalesce(p_base_retencion, 0), 2)
    or coalesce(p_retencion_pct, 0) < 0
    or coalesce(p_retencion_monto, 0) < 0
    or coalesce(p_retencion_monto, 0) > p_monto_bruto
    or coalesce(p_retencion_monto, 0) <> round(coalesce(p_retencion_monto, 0), 2) then
    raise exception 'Datos de pago invalidos';
  end if;

  if p_modo = 'directo' and jsonb_array_length(p_facturas) <> 1 then
    raise exception 'El pago directo requiere exactamente una factura';
  end if;

  if (select count(*) <> count(distinct item->>'id') from jsonb_array_elements(p_facturas) item) then
    raise exception 'Hay facturas repetidas en el pago';
  end if;

  select p.razon_social into v_proveedor_nombre
  from public.proveedores p
  where p.id = p_proveedor_id
    and p.sociedad_id = p_sociedad_id;

  if v_proveedor_nombre is null then
    raise exception 'El proveedor no pertenece a la sociedad activa';
  end if;

  for v_medio in select value from jsonb_array_elements(p_medios)
  loop
    if coalesce(v_medio->>'tipo', '') not in (
      'transferencia', 'efectivo', 'deposito', 'tarjeta', 'cheque', 'cheque_propio', 'echeq'
    )
      or coalesce((v_medio->>'monto')::numeric, 0) <= 0
      or (v_medio->>'monto')::numeric <> round((v_medio->>'monto')::numeric, 2)
      or coalesce(v_medio->>'moneda', p_moneda) <> p_moneda then
      raise exception 'Hay un medio de pago invalido';
    end if;
    if p_modo = 'directo' and coalesce(v_medio->>'tipo', '') in ('cheque', 'cheque_propio', 'echeq') then
      raise exception 'Los cheques requieren una orden de pago';
    end if;
    v_total_medios := v_total_medios + (v_medio->>'monto')::numeric;
  end loop;

  v_neto_esperado := round(p_monto_bruto - coalesce(p_retencion_monto, 0), 2);
  if p_modo = 'directo' and v_total_medios <> v_neto_esperado then
    raise exception 'Los medios deben coincidir con el bruto menos la retencion';
  end if;
  if p_modo = 'op' and v_total_medios < v_neto_esperado then
    raise exception 'Los medios no alcanzan el neto a pagar';
  end if;
  if p_modo = 'op' then
    v_saldo_favor := round(v_total_medios - v_neto_esperado, 2);
  end if;

  v_payload := jsonb_build_object(
    'modo', p_modo,
    'proveedor_id', p_proveedor_id,
    'fecha', p_fecha,
    'moneda', p_moneda,
    'facturas', p_facturas,
    'medios', p_medios,
    'monto_bruto', p_monto_bruto,
    'base_retencion', coalesce(p_base_retencion, 0),
    'retencion_pct', coalesce(p_retencion_pct, 0),
    'retencion_monto', coalesce(p_retencion_monto, 0),
    'notas', coalesce(p_notas, ''),
    'sobre_verde', coalesce(p_sobre_verde, false)
  );

  -- Serializa reintentos, saldos del proveedor y bases mensuales de retencion.
  perform pg_advisory_xact_lock(hashtextextended(p_sociedad_id::text || p_proveedor_id::text, 0));

  select * into v_existing
  from public.pago_solicitudes
  where sociedad_id = p_sociedad_id
    and request_key = p_request_key;

  if found then
    if v_existing.modo <> p_modo
      or v_existing.proveedor_id <> p_proveedor_id
      or v_existing.created_by <> auth.uid()
      or v_existing.payload <> v_payload then
      raise exception 'La solicitud ya existe con otros datos';
    end if;
    return coalesce(v_existing.resultado, '{}'::jsonb) || jsonb_build_object('replayed', true);
  end if;

  insert into public.pago_solicitudes (
    sociedad_id, request_key, modo, proveedor_id, created_by, payload
  ) values (
    p_sociedad_id, p_request_key, p_modo, p_proveedor_id, auth.uid(), v_payload
  );

  -- Locks deterministas: dos pagos concurrentes nunca validan el mismo saldo.
  perform f.id
  from jsonb_array_elements(p_facturas) item
  join public.facturas_compra f
    on f.id = (item->>'id')::uuid
   and f.sociedad_id = p_sociedad_id
   and f.proveedor_id = p_proveedor_id
  order by f.id
  for update of f;

  for v_item in select value from jsonb_array_elements(p_facturas)
  loop
    v_factura_id := (v_item->>'id')::uuid;
    v_aplicar := (v_item->>'monto')::numeric;
    if v_aplicar is null or v_aplicar <= 0 or v_aplicar <> round(v_aplicar, 2) then
      raise exception 'Importe de factura invalido';
    end if;

    select to_jsonb(f) into v_factura
    from public.facturas_compra f
    where f.id = v_factura_id
      and f.sociedad_id = p_sociedad_id
      and f.proveedor_id = p_proveedor_id;

    if v_factura is null
      or coalesce(v_factura->>'moneda', '') <> p_moneda
      or coalesce(v_factura->>'estado', '') not in ('pendiente', 'recibida') then
      raise exception 'Factura inexistente, pagada, anulada o de otra moneda/sociedad';
    end if;

    select coalesce(sum(m.monto + coalesce(m.retencion_ganancias_monto, 0)), 0)
      into v_pagado_directo
    from public.movimientos m
    where m.factura_compra_id = v_factura_id
      and m.sociedad_id = p_sociedad_id
      and m.tipo::text = 'pago'
      and not coalesce(m.anulado, false);

    select coalesce(sum(a.monto), 0)
      into v_pagado_op
    from public.op_facturas_compra a
    join public.ordenes_pago op on op.id = a.orden_pago_id
    where a.factura_compra_id = v_factura_id
      and op.sociedad_id = p_sociedad_id
      and op.estado <> 'anulada';

    v_saldo := round((v_factura->>'total')::numeric - v_pagado_directo - v_pagado_op, 2);
    if v_saldo <= 0 or v_aplicar > v_saldo then
      raise exception 'El importe supera el saldo actual de la factura';
    end if;
    -- El pago directo puede cancelar la factura completa (la validacion de arriba y el
    -- trigger validar_saldo_aplicacion_factura_compra impiden pagar de mas).

    v_documentos_total := v_documentos_total + v_aplicar;
  end loop;

  if jsonb_array_length(p_facturas) > 0 and round(v_documentos_total, 2) <> p_monto_bruto then
    raise exception 'La suma aplicada a facturas no coincide con el bruto';
  end if;
  if p_modo = 'op' and jsonb_array_length(p_facturas) = 0 and p_monto_bruto <= 0 then
    raise exception 'La OP manual requiere un importe';
  end if;

  if p_modo = 'directo' then
    insert into public.movimientos (
      tipo, proveedor_id, factura_compra_id, monto, moneda, fecha, descripcion,
      conciliado, sociedad_id, created_by, base_retencion_ganancias,
      retencion_ganancias_pct, retencion_ganancias_monto
    ) values (
      'pago', p_proveedor_id, (p_facturas->0->>'id')::uuid, v_total_medios,
      'ARS', p_fecha,
      case when v_aplicar >= v_saldo - 0.005 then 'Pago directo - ' else 'Pago parcial directo - ' end
        || coalesce(v_factura->>'numero_factura', 'FC'),
      true, p_sociedad_id, auth.uid(), coalesce(p_base_retencion, 0),
      coalesce(p_retencion_pct, 0), coalesce(p_retencion_monto, 0)
    ) returning id into v_movimiento_id;

    if coalesce(p_retencion_monto, 0) > 0 then
      insert into public.movimientos (
        tipo, proveedor_id, factura_compra_id, monto, moneda, fecha, descripcion,
        conciliado, sociedad_id, created_by, base_retencion_ganancias,
        retencion_ganancias_pct, retencion_ganancias_monto
      ) values (
        'retencion_ganancias', p_proveedor_id, (p_facturas->0->>'id')::uuid,
        p_retencion_monto, 'ARS', p_fecha,
        case when v_aplicar >= v_saldo - 0.005 then 'Pago directo' else 'Pago parcial directo' end
          || ' - Ret. Ganancias - ' || coalesce(v_factura->>'numero_factura', 'FC'),
        true, p_sociedad_id, auth.uid(), coalesce(p_base_retencion, 0),
        coalesce(p_retencion_pct, 0), coalesce(p_retencion_monto, 0)
      );
    end if;

    -- Si con este pago la factura quedo cancelada, pasa a pagada.
    update public.facturas_compra
    set estado = 'pagada'
    where id = (p_facturas->0->>'id')::uuid
      and sociedad_id = p_sociedad_id
      and estado in ('pendiente', 'recibida')
      and total - public.fc_compra_pagado(id, p_sociedad_id) <= 0.005;

    v_result := jsonb_build_object(
      'modo', 'directo',
      'movimiento_id', v_movimiento_id,
      'saldo_a_favor', 0,
      'request_key', p_request_key,
      'replayed', false
    );
  else
    v_op_numero := public.next_op_number(p_sociedad_id);

    insert into public.ordenes_pago (
      numero, fecha, proveedor_id, monto_bruto, base_retencion_ganancias,
      retencion_porcentaje, retencion_monto, retencion_ganancias_pct,
      retencion_ganancias_monto, neto_a_pagar, moneda, medio_pago,
      medios_pago, notas, estado, sobre_verde, saldo_a_favor,
      sociedad_id, created_by
    ) values (
      v_op_numero, p_fecha, p_proveedor_id, p_monto_bruto,
      coalesce(p_base_retencion, 0), 0, 0, coalesce(p_retencion_pct, 0),
      coalesce(p_retencion_monto, 0), v_total_medios, 'ARS',
      p_medios->0->>'tipo', p_medios, nullif(trim(p_notas), ''),
      'pagada', coalesce(p_sobre_verde, false), v_saldo_favor,
      p_sociedad_id, auth.uid()
    ) returning id into v_op_id;

    insert into public.op_facturas_compra (orden_pago_id, factura_compra_id, monto)
      select v_op_id, (item->>'id')::uuid, (item->>'monto')::numeric
      from jsonb_array_elements(p_facturas) item;

    insert into public.movimientos (
      tipo, proveedor_id, monto, moneda, fecha, descripcion, conciliado,
      sociedad_id, created_by, orden_pago_id
    ) values (
      'pago', p_proveedor_id, v_total_medios, 'ARS', p_fecha,
      v_op_numero || ' - ' || v_proveedor_nombre ||
        case when v_saldo_favor > 0 then ' - credito a favor ' || v_saldo_favor::text else '' end,
      true, p_sociedad_id, auth.uid(), v_op_id
    ) returning id into v_movimiento_id;

    if coalesce(p_retencion_monto, 0) > 0 then
      insert into public.movimientos (
        tipo, proveedor_id, monto, moneda, fecha, descripcion, conciliado,
        sociedad_id, created_by, orden_pago_id
      ) values (
        'retencion_ganancias', p_proveedor_id, p_retencion_monto, 'ARS',
        p_fecha, v_op_numero || ' - Ret. Ganancias - ' || v_proveedor_nombre,
        true, p_sociedad_id, auth.uid(), v_op_id
      );
    end if;

    if v_saldo_favor > 0 then
      insert into public.saldos_favor_proveedor (
        sociedad_id, proveedor_id, orden_pago_id, moneda,
        monto_original, saldo, created_by
      ) values (
        p_sociedad_id, p_proveedor_id, v_op_id, p_moneda,
        v_saldo_favor, v_saldo_favor, auth.uid()
      );
    end if;

    -- La cartera tambien es parte de la saga: cualquier conflicto revierte OP,
    -- aplicaciones, movimientos, credito y numeracion dentro de este request.
    for v_medio, v_ordinal in
      select value, ordinality from jsonb_array_elements(p_medios) with ordinality
    loop
      if coalesce(v_medio->>'tipo', '') not in ('cheque', 'cheque_propio', 'echeq') then
        continue;
      end if;

      if nullif(v_medio->>'echeq_id', '') is not null then
        select to_jsonb(e) into v_echeq
        from public.echeqs e
        where e.id = (v_medio->>'echeq_id')::uuid
          and e.sociedad_id = p_sociedad_id
        for update;

        if v_echeq is null
          or coalesce(v_echeq->>'moneda', '') <> p_moneda
          or round((v_echeq->>'monto')::numeric, 2) <> round((v_medio->>'monto')::numeric, 2) then
          raise exception 'El cheque no existe o no coincide con el medio';
        end if;

        if v_medio->>'tipo' = 'cheque_propio' then
          if v_echeq->>'direccion' <> 'emitido' or v_echeq->>'estado' <> 'pendiente' then
            raise exception 'El cheque propio ya no esta pendiente';
          end if;
          update public.echeqs
          set estado = 'entregado', destino_tipo = 'proveedor',
              destino_id = p_proveedor_id, destino_nombre = v_proveedor_nombre
          where id = (v_medio->>'echeq_id')::uuid;
        else
          if coalesce(v_echeq->>'direccion', 'recibido') <> 'recibido'
            or v_echeq->>'estado' <> 'en_cartera' then
            raise exception 'El cheque recibido ya no esta en cartera';
          end if;
          update public.echeqs
          set estado = 'endosado', destino_tipo = 'proveedor',
              destino_id = p_proveedor_id, destino_nombre = v_proveedor_nombre,
              fecha_endoso = p_fecha
          where id = (v_medio->>'echeq_id')::uuid;
        end if;
      elsif v_medio->>'tipo' = 'cheque_propio' then
        v_numero_cheque := coalesce(
          nullif(trim(v_medio->>'numero_cheque'), ''),
          'CHQ-' || left(replace(p_request_key::text, '-', ''), 12) || '-' || v_ordinal::text
        );
        insert into public.echeqs (
          tipo_cheque, direccion, numero, banco_emisor, monto, moneda,
          fecha_emision, fecha_pago, estado, destino_tipo, destino_id,
          destino_nombre, sociedad_id, user_id
        ) values (
          case when coalesce(v_medio->>'tipo_cheque', '') = 'echeq' then 'echeq' else 'fisico' end,
          'emitido', v_numero_cheque,
          nullif(trim(v_medio->>'banco'), ''), (v_medio->>'monto')::numeric,
          'ARS', nullif(v_medio->>'fecha_emision', '')::date,
          coalesce(nullif(v_medio->>'fecha_cobro', '')::date, p_fecha),
          'entregado', 'proveedor', p_proveedor_id, v_proveedor_nombre,
          p_sociedad_id, auth.uid()
        );
      else
        raise exception 'El cheque recibido debe seleccionarse desde la cartera';
      end if;
    end loop;

    for v_item in select value from jsonb_array_elements(p_facturas)
    loop
      v_factura_id := (v_item->>'id')::uuid;
      select coalesce(sum(m.monto + coalesce(m.retencion_ganancias_monto, 0)), 0)
        into v_pagado_directo
      from public.movimientos m
      where m.factura_compra_id = v_factura_id
        and m.sociedad_id = p_sociedad_id
        and m.tipo::text = 'pago'
        and not coalesce(m.anulado, false);
      select coalesce(sum(a.monto), 0) into v_pagado_op
      from public.op_facturas_compra a
      join public.ordenes_pago op on op.id = a.orden_pago_id
      where a.factura_compra_id = v_factura_id
        and op.sociedad_id = p_sociedad_id
        and op.estado <> 'anulada';
      update public.facturas_compra
      set estado = case
        when v_pagado_directo + v_pagado_op >= total - 0.005 then 'pagada'
        else estado
      end
      where id = v_factura_id and sociedad_id = p_sociedad_id;
    end loop;

    v_result := jsonb_build_object(
      'modo', 'op',
      'orden_pago_id', v_op_id,
      'numero', v_op_numero,
      'movimiento_id', v_movimiento_id,
      'saldo_a_favor', v_saldo_favor,
      'request_key', p_request_key,
      'replayed', false
    );
  end if;

  update public.pago_solicitudes
  set resultado = v_result
  where sociedad_id = p_sociedad_id
    and request_key = p_request_key;

  return v_result;
end;
$$;

revoke all on function public.registrar_pago_proveedor_seguro(
  uuid, uuid, text, uuid, date, text, jsonb, jsonb, numeric, numeric,
  numeric, numeric, text, boolean
) from public, anon;
grant execute on function public.registrar_pago_proveedor_seguro(
  uuid, uuid, text, uuid, date, text, jsonb, jsonb, numeric, numeric,
  numeric, numeric, text, boolean
) to authenticated;

-- 5) Vista de pendientes de facturar: sin asignaciones de facturas anuladas (mismas columnas)
create or replace view public.orden_compra_items_pendientes with (security_invoker = true) as
select i.id, i.orden_id, i.codigo, i.descripcion, i.cantidad, i.precio_unitario, i.iva_porcentaje, i.unidad, i.orden,
       coalesce(a.asignada, 0) as cantidad_asignada,
       case when coalesce(oc.saldo_cerrado, false) then 0 else i.cantidad - coalesce(a.asignada, 0) end as cantidad_pendiente,
       i.codigo_proveedor, i.descripcion_proveedor, i.talle, i.catalogo_id
from public.orden_compra_items i
join public.ordenes_compra oc on oc.id = i.orden_id
left join (
  -- Las asignaciones de facturas anuladas ya no cuentan como facturado.
  select x.orden_compra_item_id, sum(x.cantidad) as asignada
  from public.factura_compra_asignaciones x
  where not exists (
    select 1 from public.facturas_compra fa
    where fa.id = x.factura_compra_id and fa.estado = 'anulada'
  )
  group by x.orden_compra_item_id
) a on a.orden_compra_item_id = i.id;
grant select on public.orden_compra_items_pendientes to authenticated;

-- 6) C1/C2 · Conciliación: duplicado por tipo, exceso como aviso.
-- Se reemplaza la versión de 8 parámetros por una de 9 (p_confirmar con default) para que
-- la API no tenga dos funciones con el mismo nombre que coincidan con la misma llamada.
drop function if exists public.guardar_conciliacion_compra(uuid, uuid, jsonb, jsonb, jsonb, boolean, boolean, jsonb);

create or replace function public.guardar_conciliacion_compra(
  p_sociedad_id uuid,
  p_factura_id uuid,          -- null = factura nueva; id = retomar una conciliación parcial
  p_factura jsonb,            -- encabezado
  p_items jsonb,              -- [{key, codigo, descripcion, cantidad, precio_unitario, descuento_porcentaje, iva_porcentaje, unidad}]
  p_asignaciones jsonb,       -- [{key, orden_compra_item_id, cantidad, precio_factura, precio_oc, origen}]
  p_borrador boolean,         -- true = "Conciliación parcial" (no va a pagos)
  p_aceptar_costos boolean,   -- true = actualizar el costo de la OC al precio facturado
  p_equivalencias jsonb,      -- [{producto_factura, producto_oc, codigo_proveedor}]
  p_confirmar boolean default false -- true = el usuario ya vio el aviso de exceso y confirma
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user uuid := auth.uid();
  v_factura_id uuid;
  v_proveedor_id uuid;
  v_numero text;
  v_norm text;
  v_partes text[];
  v_estado text;
  v_item jsonb;
  v_asig jsonb;
  v_keys jsonb := '{}'::jsonb;
  v_new_id uuid;
  v_oc_item record;
  v_oc_id uuid;
  v_exceso record;
  v_ocs uuid[];
  v_hist text;
  v_moneda text;
  v_oc_row record;
  v_pr_ids text;
  v_cambio record;
  v_pi record;
  v_rate numeric;
  v_conv numeric;
  v_venta numeric;
  v_markup numeric;
  v_pr_hist jsonb := '{}'::jsonb;
  v_pr_count integer := 0;
  v_sin_pr text[] := '{}';
  v_k text;
  v_tipo text;
  v_aviso text;
  v_excesos jsonb;
begin
  if v_user is null
    or not exists (select 1 from public.profiles where id = v_user and active and role::text in ('super_admin','admin','administrativo','vendedor'))
    or not exists (select 1 from public.user_sociedades where user_id = v_user and sociedad_id = p_sociedad_id)
  then
    raise exception 'No tenés autorización para cargar compras en esta sociedad' using errcode = '42501';
  end if;

  if p_factura is null or jsonb_typeof(p_factura) <> 'object'
    or p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 500
    or p_asignaciones is null or jsonb_typeof(p_asignaciones) <> 'array' or jsonb_array_length(p_asignaciones) > 2000
  then
    raise exception 'Datos incompletos de la factura' using errcode = '22023';
  end if;

  v_proveedor_id := nullif(p_factura->>'proveedor_id','')::uuid;
  v_numero := btrim(coalesce(p_factura->>'numero_factura',''));
  if v_proveedor_id is null or v_numero = '' then
    raise exception 'Falta el proveedor o el número de factura' using errcode = '22023';
  end if;
  if not exists (select 1 from public.proveedores where id = v_proveedor_id and sociedad_id = p_sociedad_id) then
    raise exception 'El proveedor no pertenece a la sociedad seleccionada' using errcode = '22023';
  end if;

  -- Número duplicado del mismo proveedor y MISMO tipo de comprobante (FC A, FC B, NC A... son
  -- series distintas); las anuladas no cuentan. Ignora la propia factura si se está retomando.
  v_tipo := upper(regexp_replace(btrim(coalesce(nullif(p_factura->>'tipo_comprobante',''), 'FC A')), '\s+', ' ', 'g'));
  v_norm := upper(regexp_replace(v_numero, '\s+', '', 'g'));
  v_partes := regexp_match(v_norm, '^([0-9]{1,5})[-/]([0-9]{1,8})$');
  if v_partes is not null then v_norm := lpad(v_partes[1],5,'0') || '-' || lpad(v_partes[2],8,'0'); end if;
  perform pg_advisory_xact_lock(hashtextextended(p_sociedad_id::text || ':' || v_proveedor_id::text || ':' || v_norm, 0));
  if exists (
    select 1 from public.facturas_compra fc
    left join lateral regexp_match(upper(regexp_replace(btrim(fc.numero_factura), '\s+', '', 'g')), '^([0-9]{1,5})[-/]([0-9]{1,8})$') as p(parts) on true
    where fc.sociedad_id = p_sociedad_id and fc.proveedor_id = v_proveedor_id
      and fc.estado <> 'anulada'
      and upper(regexp_replace(btrim(coalesce(fc.tipo_comprobante, 'FC A')), '\s+', ' ', 'g')) = v_tipo
      and fc.id is distinct from p_factura_id
      and (case when p.parts is null then upper(regexp_replace(btrim(fc.numero_factura), '\s+', '', 'g'))
                else lpad(p.parts[1],5,'0') || '-' || lpad(p.parts[2],8,'0') end) = v_norm
  ) then
    raise exception 'La % % de este proveedor ya está cargada', v_tipo, v_numero using errcode = '23505';
  end if;

  -- Facturado de más contra la OC (sumando otras facturas NO anuladas): es un aviso, no traba.
  -- Se revisa antes de escribir nada: sin confirmación devuelve el aviso y no guarda.
  select string_agg(format('«%s» quedaría con %s facturadas de %s pedidas', x.descripcion, x.asignada, x.cantidad), '; ' order by x.descripcion),
         coalesce(jsonb_agg(jsonb_build_object('orden_compra_item_id', x.id, 'descripcion', x.descripcion,
           'pedida', x.cantidad, 'facturada', x.asignada)), '[]'::jsonb)
    into v_aviso, v_excesos
  from (
    select i.id, i.descripcion, i.cantidad, coalesce(prev.asignada, 0) + n.cantidad_nueva as asignada
    from (
      select (e->>'orden_compra_item_id')::uuid as item_id, sum((e->>'cantidad')::numeric) as cantidad_nueva
      from jsonb_array_elements(p_asignaciones) e
      where coalesce((e->>'cantidad')::numeric, 0) > 0
      group by 1
    ) n
    join public.orden_compra_items i on i.id = n.item_id
    join public.ordenes_compra oc on oc.id = i.orden_id
      and oc.sociedad_id = p_sociedad_id and oc.proveedor_id = v_proveedor_id
    left join lateral (
      select sum(x2.cantidad) as asignada
      from public.factura_compra_asignaciones x2
      where x2.orden_compra_item_id = i.id
        and x2.factura_compra_id is distinct from p_factura_id
        and not exists (
          select 1 from public.facturas_compra f2
          where f2.id = x2.factura_compra_id and f2.estado = 'anulada'
        )
    ) prev on true
    where coalesce(prev.asignada, 0) + n.cantidad_nueva > i.cantidad + 0.0001
  ) x;
  if v_aviso is not null then
    v_aviso := 'Hay líneas de OC que quedarían facturadas de más: ' || v_aviso || '.';
    if not coalesce(p_confirmar, false) then
      return jsonb_build_object('requiere_confirmacion', true, 'aviso', v_aviso, 'excesos', v_excesos);
    end if;
  end if;

  v_estado := case when p_borrador then 'en_conciliacion' else 'pendiente_aprobacion' end;

  if p_factura_id is not null then
    select id into v_factura_id from public.facturas_compra
      where id = p_factura_id and sociedad_id = p_sociedad_id and estado = 'en_conciliacion' for update;
    if v_factura_id is null then
      raise exception 'Solo se puede retomar una factura en conciliación parcial' using errcode = '22023';
    end if;
    delete from public.factura_compra_asignaciones where factura_compra_id = v_factura_id;
    delete from public.facturas_compra_items where factura_compra_id = v_factura_id;
    delete from public.factura_compra_ocs where factura_compra_id = v_factura_id;
    update public.facturas_compra set
      proveedor_id = v_proveedor_id, numero_factura = v_numero,
      tipo_comprobante = coalesce(nullif(p_factura->>'tipo_comprobante',''), tipo_comprobante),
      fecha = coalesce(nullif(p_factura->>'fecha','')::date, fecha),
      fecha_vencimiento = nullif(p_factura->>'fecha_vencimiento','')::date,
      cae = nullif(p_factura->>'cae',''),
      moneda = coalesce(nullif(p_factura->>'moneda',''), moneda),
      subtotal = coalesce((p_factura->>'subtotal')::numeric, 0),
      iva_porcentaje = coalesce((p_factura->>'iva_porcentaje')::numeric, 21),
      iva = coalesce((p_factura->>'iva')::numeric, 0),
      percepciones = coalesce((p_factura->>'percepciones')::numeric, 0),
      total = coalesce((p_factura->>'total')::numeric, 0),
      notas = coalesce(p_factura->>'notas', notas),
      estado = v_estado
    where id = v_factura_id;
  else
    insert into public.facturas_compra (numero_factura, tipo_comprobante, proveedor_id, fecha, fecha_vencimiento, cae, moneda,
      subtotal, iva_porcentaje, iva, percepciones, total, estado, tipo, solo_iva, notas, sociedad_id, created_by)
    values (v_numero, coalesce(nullif(p_factura->>'tipo_comprobante',''), 'FC A'), v_proveedor_id,
      coalesce(nullif(p_factura->>'fecha','')::date, current_date), nullif(p_factura->>'fecha_vencimiento','')::date,
      nullif(p_factura->>'cae',''), coalesce(nullif(p_factura->>'moneda',''), 'ARS'),
      coalesce((p_factura->>'subtotal')::numeric, 0), coalesce((p_factura->>'iva_porcentaje')::numeric, 21),
      coalesce((p_factura->>'iva')::numeric, 0), coalesce((p_factura->>'percepciones')::numeric, 0),
      coalesce((p_factura->>'total')::numeric, 0), v_estado, 'mercaderia', false,
      coalesce(p_factura->>'notas',''), p_sociedad_id, v_user)
    returning id into v_factura_id;
  end if;

  -- Líneas de la factura
  for v_item in select * from jsonb_array_elements(p_items) loop
    insert into public.facturas_compra_items (factura_compra_id, codigo, descripcion, cantidad, precio_unitario,
      descuento_porcentaje, iva_porcentaje, unidad, sociedad_id)
    values (v_factura_id, nullif(v_item->>'codigo',''), coalesce(v_item->>'descripcion',''),
      coalesce((v_item->>'cantidad')::numeric, 0), coalesce((v_item->>'precio_unitario')::numeric, 0),
      least(100, greatest(0, coalesce((v_item->>'descuento_porcentaje')::numeric, 0))),
      coalesce((v_item->>'iva_porcentaje')::numeric, 21), coalesce(nullif(v_item->>'unidad',''), 'UN'), p_sociedad_id)
    returning id into v_new_id;
    v_keys := v_keys || jsonb_build_object(coalesce(v_item->>'key', v_new_id::text), v_new_id);
  end loop;

  -- Asignaciones a líneas de OC (mismo proveedor y sociedad)
  for v_asig in select * from jsonb_array_elements(p_asignaciones) loop
    if (v_asig->>'cantidad')::numeric is null or (v_asig->>'cantidad')::numeric <= 0 then continue; end if;
    select i.id, i.orden_id, i.descripcion into v_oc_item
      from public.orden_compra_items i join public.ordenes_compra o on o.id = i.orden_id
      where i.id = (v_asig->>'orden_compra_item_id')::uuid and o.sociedad_id = p_sociedad_id and o.proveedor_id = v_proveedor_id
      for update of i;
    if v_oc_item.id is null then
      raise exception 'Una línea asignada no pertenece a una OC de este proveedor' using errcode = '22023';
    end if;
    if not (v_keys ? (v_asig->>'key')) then
      raise exception 'Una asignación no corresponde a ninguna línea de la factura' using errcode = '22023';
    end if;
    insert into public.factura_compra_asignaciones (sociedad_id, factura_compra_id, factura_compra_item_id, orden_compra_id,
      orden_compra_item_id, cantidad, precio_factura, precio_oc, origen, created_by)
    values (p_sociedad_id, v_factura_id, (v_keys->>(v_asig->>'key'))::uuid, v_oc_item.orden_id, v_oc_item.id,
      (v_asig->>'cantidad')::numeric, coalesce((v_asig->>'precio_factura')::numeric, 0), coalesce((v_asig->>'precio_oc')::numeric, 0),
      coalesce(nullif(v_asig->>'origen',''), 'manual'), v_user);
  end loop;

  select coalesce(array_agg(distinct orden_compra_id), '{}') into v_ocs from public.factura_compra_asignaciones where factura_compra_id = v_factura_id;
  insert into public.factura_compra_ocs (factura_compra_id, orden_compra_id)
    select v_factura_id, unnest(v_ocs) on conflict do nothing;

  -- Aceptar el nuevo costo: la línea de OC toma el precio facturado (con historial en la OC)
  -- y el artículo del presupuesto de origen toma el mismo costo, manteniendo el precio de venta
  -- (se recalcula el margen) y dejando el historial en las observaciones del presupuesto.
  if not p_borrador and coalesce(p_aceptar_costos, true) then
    v_moneda := coalesce(nullif(p_factura->>'moneda',''), 'ARS');
    foreach v_oc_id in array v_ocs loop
      select id, presupuesto_origen_id, observaciones into v_oc_row from public.ordenes_compra where id = v_oc_id;
      v_pr_ids := (regexp_match(coalesce(v_oc_row.observaciones,''), '\[PR_ITEMS:([^\]]+)\]'))[1];
      v_hist := null;
      for v_cambio in
        select i.id, i.codigo, i.descripcion, i.precio_unitario as viejo, x.precio as nuevo
        from (
          select orden_compra_item_id, max(precio_factura) as precio
          from public.factura_compra_asignaciones
          where factura_compra_id = v_factura_id and orden_compra_id = v_oc_id
          group by orden_compra_item_id having count(distinct precio_factura) = 1
        ) x join public.orden_compra_items i on i.id = x.orden_compra_item_id
        order by i.orden
      loop
        if abs(v_cambio.viejo - v_cambio.nuevo) >= 0.005 then
          update public.orden_compra_items set precio_unitario = v_cambio.nuevo where id = v_cambio.id;
          v_hist := coalesce(v_hist || '; ', '') || v_cambio.descripcion || ': ' || v_cambio.viejo || ' → ' || v_cambio.nuevo;
        end if;

        -- Artículo del presupuesto: en OC consolidadas viene la lista [PR_ITEMS:...]; si no, el PR de origen.
        if v_pr_ids is null and v_oc_row.presupuesto_origen_id is null then continue; end if;
        v_pi := null;
        select pi.*, p.moneda as pr_moneda, p.tipo_cambio as pr_tc, p.tipo_cambio_divisas as pr_tcd, p.numero as pr_numero, s.score,
               count(*) over (partition by s.score) as empatados
          into v_pi
          from public.presupuesto_items pi
          join public.presupuestos p on p.id = pi.presupuesto_id
          cross join lateral (select
              (case when nullif(btrim(pi.codigo),'') is not null and lower(btrim(pi.codigo)) = lower(btrim(v_cambio.codigo)) then 2 else 0 end)
            + (case when lower(btrim(pi.descripcion)) = lower(btrim(regexp_replace(v_cambio.descripcion, '\s*\[[^\]]*\]\s*$', ''))) then 1 else 0 end) as score) s
          where s.score > 0
            and ((v_pr_ids is not null and pi.id::text = any(string_to_array(replace(v_pr_ids,' ',''), ',')))
              or (v_pr_ids is null and pi.presupuesto_id = v_oc_row.presupuesto_origen_id))
          order by s.score desc
          limit 1;
        if v_pi.id is not null and abs(v_pi.precio_costo - v_cambio.nuevo) < 0.005 and coalesce(v_pi.costo_moneda,'ARS') = v_moneda then
          continue; -- el presupuesto ya tiene ese costo
        end if;
        if v_pi.id is null or v_pi.empatados > 1 then
          v_sin_pr := array_append(v_sin_pr, v_cambio.descripcion);
          continue;
        end if;
        -- Costo nuevo en la moneda del presupuesto
        v_rate := case when coalesce(v_pi.pr_tc,0) > 0 then v_pi.pr_tc else coalesce(v_pi.pr_tcd,0) end;
        v_conv := case
          when replace(coalesce(v_pi.pr_moneda::text,'ARS'),' Divisa','') = replace(v_moneda,' Divisa','') then v_cambio.nuevo
          when v_rate > 0 and v_moneda like 'USD%' and coalesce(v_pi.pr_moneda::text,'ARS') = 'ARS' then v_cambio.nuevo * v_rate
          when v_rate > 0 and v_moneda = 'ARS' and coalesce(v_pi.pr_moneda::text,'ARS') like 'USD%' then v_cambio.nuevo / v_rate
          else null end;
        v_venta := coalesce(v_pi.precio_venta, v_pi.precio_costo * (1 + coalesce(v_pi.markup_porcentaje,0) / 100));
        if v_conv is null or v_conv <= 0 or v_venta is null then
          v_sin_pr := array_append(v_sin_pr, v_cambio.descripcion || ' (no se pudo convertir la moneda)');
          continue;
        end if;
        -- Con descuentos, el markup se calcula sobre el precio de LISTA; precio_venta (neto) no cambia.
        v_markup := round(((coalesce(v_pi.precio_lista, v_venta) / v_conv) - 1) * 100, 2);
        update public.presupuesto_items
          set precio_costo = v_cambio.nuevo, costo_moneda = v_moneda, markup_porcentaje = v_markup, precio_venta = v_venta
          where id = v_pi.id;
        v_pr_count := v_pr_count + 1;
        v_pr_hist := jsonb_set(v_pr_hist, array[v_pi.presupuesto_id::text], to_jsonb(
          coalesce((v_pr_hist->>(v_pi.presupuesto_id::text)) || '; ', '') || v_pi.descripcion || ': costo ' || v_pi.precio_costo || ' ' || coalesce(v_pi.costo_moneda,'ARS') || ' → ' || v_cambio.nuevo || ' ' || v_moneda
          || ' (margen ' || coalesce(v_pi.markup_porcentaje,0) || '% → ' || v_markup || '%)'));
      end loop;

      if v_hist is not null then
        update public.ordenes_compra o set
          subtotal = t.neto, iva = t.iva, total = t.neto + t.iva,
          observaciones = coalesce(o.observaciones,'') || E'\n[' || to_char(now() at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY HH24:MI') || '] FC ' || v_numero || ': ' || v_hist,
          updated_at = now()
        from (
          select orden_id, round(sum(cantidad * precio_unitario), 2) as neto,
                 round(sum(cantidad * precio_unitario * iva_porcentaje / 100), 2) as iva
          from public.orden_compra_items where orden_id = v_oc_id group by orden_id
        ) t where o.id = v_oc_id and t.orden_id = o.id;
      end if;
    end loop;

    for v_k in select jsonb_object_keys(v_pr_hist) loop
      update public.presupuestos set observaciones = coalesce(observaciones,'') || E'\n[' || to_char(now() at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY HH24:MI') || '] FC ' || v_numero || ': ' || (v_pr_hist->>v_k)
        where id = v_k::uuid;
    end loop;
  end if;

  -- Estado de facturación de cada OC tocada
  update public.ordenes_compra o set estado_facturacion = case
      when s.pendiente <= 0.0001 then 'facturada'
      when s.asignada > 0 then 'parcial'
      else null end
  from (
    select i.orden_id, sum(i.cantidad - coalesce(a.asignada,0)) as pendiente, sum(coalesce(a.asignada,0)) as asignada
    from public.orden_compra_items i
    left join (select x.orden_compra_item_id, sum(x.cantidad) as asignada from public.factura_compra_asignaciones x
               where not exists (select 1 from public.facturas_compra fa where fa.id = x.factura_compra_id and fa.estado = 'anulada')
               group by x.orden_compra_item_id) a
      on a.orden_compra_item_id = i.id
    where i.orden_id = any(v_ocs)
    group by i.orden_id
  ) s where o.id = s.orden_id;

  -- Aprender equivalencias (solo al guardar completa)
  if not p_borrador and p_equivalencias is not null and jsonb_typeof(p_equivalencias) = 'array' then
    insert into public.proveedor_equivalencias (sociedad_id, proveedor_id, producto_factura, producto_oc, codigo_proveedor, created_by)
    select p_sociedad_id, v_proveedor_id, e->>'producto_factura', e->>'producto_oc', nullif(e->>'codigo_proveedor',''), v_user
    from jsonb_array_elements(p_equivalencias) e
    where coalesce(e->>'producto_factura','') <> '' and coalesce(e->>'producto_oc','') <> ''
    on conflict (sociedad_id, proveedor_id, producto_factura, producto_oc)
    do update set veces = public.proveedor_equivalencias.veces + 1, updated_at = now(),
      codigo_proveedor = coalesce(excluded.codigo_proveedor, public.proveedor_equivalencias.codigo_proveedor);
  end if;

  return jsonb_build_object('factura_compra_id', v_factura_id, 'estado', v_estado, 'ocs', to_jsonb(v_ocs),
    'presupuestos_items_actualizados', v_pr_count, 'presupuestos_actualizados', (select count(*) from jsonb_object_keys(v_pr_hist)),
    'sin_presupuesto', to_jsonb(v_sin_pr), 'aviso', v_aviso);
end;
$$;

revoke all on function public.guardar_conciliacion_compra(uuid, uuid, jsonb, jsonb, jsonb, boolean, boolean, jsonb, boolean) from public, anon;
grant execute on function public.guardar_conciliacion_compra(uuid, uuid, jsonb, jsonb, jsonb, boolean, boolean, jsonb, boolean) to authenticated;

-- La API (PostgREST) toma la firma nueva de guardar_conciliacion_compra.
notify pgrst, 'reload schema';

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- CONSULTAS DE CONTROL (solo lectura)
-- Correrlas DESPUÉS de esta migración (usan public.fc_compra_pagado). No modifican nada.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- 1) Facturas de compra marcadas "pagada" que en realidad tienen saldo (p. ej. por anular una OP
--    con NC antes de este arreglo). Columna anulada_op = true si tuvo alguna OP anulada.
-- select s.nombre as sociedad, p.razon_social, f.tipo_comprobante, f.numero_factura, f.fecha, f.moneda,
--        f.total, public.fc_compra_pagado(f.id, f.sociedad_id) as cancelado,
--        round(f.total - public.fc_compra_pagado(f.id, f.sociedad_id), 2) as saldo_real,
--        exists (select 1 from public.op_facturas_compra a join public.ordenes_pago op on op.id = a.orden_pago_id
--                where a.factura_compra_id = f.id and op.estado = 'anulada') as anulada_op
-- from public.facturas_compra f
-- join public.proveedores p on p.id = f.proveedor_id
-- join public.sociedades s on s.id = f.sociedad_id
-- where f.estado = 'pagada'
--   and upper(coalesce(f.tipo_comprobante, '')) not like 'NC%'
--   and f.total - public.fc_compra_pagado(f.id, f.sociedad_id) > 0.005
-- order by anulada_op desc, f.fecha;
--
-- 2) OPs anuladas cuyas NC siguen aplicadas (quedaron "usadas" aunque la OP no existe más).
-- select op.numero as op, op.fecha, nc.numero_factura as nc, f.numero_factura as factura, o.monto
-- from public.op_notas_credito_compra o
-- join public.ordenes_pago op on op.id = o.orden_pago_id
-- join public.movimientos m on m.id = o.movimiento_id
-- join public.facturas_compra nc on nc.id = o.nota_credito_compra_id
-- join public.facturas_compra f on f.id = o.factura_compra_id
-- where op.estado = 'anulada' and not coalesce(m.anulado, false)
-- order by op.fecha;
--
-- 3) Renglones del Plan de pagos que figuran "pagado" con la OP anulada.
-- select l.numero as plan, i.razon_social, i.neto, op.numero as op
-- from public.pagos_lote_items i
-- join public.pagos_lotes l on l.id = i.lote_id
-- join public.ordenes_pago op on op.id = i.orden_pago_id
-- where i.estado = 'pagado' and op.estado = 'anulada';
--
-- 4) Facturas en USD con NC donde la liquidación en dólares contaba dos veces la NC
--    (saldo_viejo = lo que mostraba antes; saldo_real = lo que queda de verdad por pagar).
-- select p.razon_social, f.numero_factura, f.total, f.total_acreditado,
--        round(f.total - coalesce(f.total_acreditado, 0)
--          - coalesce((select sum(m.monto + coalesce(m.retencion_ganancias_monto, 0)) from public.movimientos m
--                      where m.factura_compra_id = f.id and m.sociedad_id = f.sociedad_id and m.tipo::text = 'pago'
--                        and not coalesce(m.anulado, false)), 0)
--          - coalesce((select sum(a.monto) from public.op_facturas_compra a join public.ordenes_pago op on op.id = a.orden_pago_id
--                      where a.factura_compra_id = f.id and op.sociedad_id = f.sociedad_id and op.estado <> 'anulada'), 0), 2) as saldo_viejo,
--        round(f.total - public.fc_compra_pagado(f.id, f.sociedad_id), 2) as saldo_real,
--        f.estado,
--        exists (select 1 from public.aplicaciones_fx ap join public.liquidaciones_fx lq on lq.id = ap.liquidacion_id
--                where ap.documento_id = f.id and lq.kind = 'pago' and not lq.anulado) as tiene_liquidacion_fx
-- from public.facturas_compra f
-- join public.proveedores p on p.id = f.proveedor_id
-- where f.moneda = 'USD' and f.estado <> 'anulada'
--   and upper(coalesce(f.tipo_comprobante, '')) not like 'NC%'
--   and (coalesce(f.total_acreditado, 0) > 0
--        or exists (select 1 from public.movimientos m where m.factura_compra_id = f.id
--                   and m.nota_credito_compra_id is not null and not coalesce(m.anulado, false)))
-- order by p.razon_social, f.fecha;
--
-- 5) Facturas donde total_acreditado y los movimientos de NC no coinciden (para revisar a mano).
-- select f.numero_factura, f.total_acreditado, coalesce(sum(m.monto), 0) as nc_movimientos
-- from public.facturas_compra f
-- left join public.movimientos m on m.factura_compra_id = f.id and m.nota_credito_compra_id is not null
--   and not coalesce(m.anulado, false)
-- where f.estado <> 'anulada'
-- group by f.id, f.numero_factura, f.total_acreditado
-- having abs(coalesce(f.total_acreditado, 0) - coalesce(sum(m.monto), 0)) > 0.005;
--
-- 6) Líneas de OC que tenían asignaciones de facturas ANULADAS (antes trababan la conciliación).
-- select oc.numero as oc, i.descripcion, i.cantidad, f.numero_factura, x.cantidad as asignada_anulada
-- from public.factura_compra_asignaciones x
-- join public.facturas_compra f on f.id = x.factura_compra_id
-- join public.orden_compra_items i on i.id = x.orden_compra_item_id
-- join public.ordenes_compra oc on oc.id = i.orden_id
-- where f.estado = 'anulada'
-- order by oc.numero;
--
-- 7) ¿Existe el índice viejo que permite UN solo movimiento por NC? Si devuelve una fila, una NC
--    no se puede aplicar a dos facturas ni volver a usarse después de anular la OP que la usó
--    (avisar antes de tocarlo: es un cambio aparte).
-- select indexname, indexdef from pg_indexes where indexname = 'movimientos_nota_credito_compra_uidx';
