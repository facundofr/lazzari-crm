-- Relación y aplicación segura de notas de crédito de proveedor.
alter table public.facturas_compra
  add column if not exists factura_origen_id uuid references public.facturas_compra(id) on delete restrict,
  add column if not exists credito_aplicado numeric(15,2) not null default 0,
  add column if not exists total_acreditado numeric(15,2) not null default 0,
  add column if not exists credito_request_key uuid,
  add column if not exists credito_request_payload jsonb;

alter table public.movimientos
  add column if not exists nota_credito_compra_id uuid references public.facturas_compra(id) on delete restrict;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.facturas_compra'::regclass
      and conname = 'facturas_compra_creditos_no_negativos'
  ) then
    alter table public.facturas_compra
      add constraint facturas_compra_creditos_no_negativos
      check (credito_aplicado >= 0 and total_acreditado >= 0);
  end if;
end
$$;

create unique index if not exists facturas_compra_credit_request_key_uidx
  on public.facturas_compra(sociedad_id, credito_request_key)
  where credito_request_key is not null;

create unique index if not exists movimientos_nota_credito_compra_uidx
  on public.movimientos(nota_credito_compra_id)
  where nota_credito_compra_id is not null;

create index if not exists facturas_compra_factura_origen_idx
  on public.facturas_compra(factura_origen_id)
  where factura_origen_id is not null;

-- Los pagos y créditos contra una FC comparten el mismo lock. Esto evita que
-- una OP o un pago directo compita con una NC y deje la factura sobreaplicada.
create or replace function public.validar_saldo_aplicacion_factura_compra()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_factura_id uuid;
  v_total numeric;
  v_aplicado numeric := 0;
  v_nuevo numeric := 0;
  v_old_orden_pago_id uuid;
  v_old_factura_id uuid;
  v_old_movimiento_id uuid;
begin
  if tg_op = 'UPDATE' then
    if tg_table_name = 'op_facturas_compra' then
      v_old_orden_pago_id := old.orden_pago_id;
      v_old_factura_id := old.factura_compra_id;
    else
      v_old_movimiento_id := old.id;
    end if;
  end if;
  if tg_table_name = 'op_facturas_compra' then
    v_factura_id := new.factura_compra_id;
    v_nuevo := coalesce(new.monto, 0);
  elsif new.factura_compra_id is not null
    and new.tipo::text = 'pago'
    and not coalesce(new.anulado, false)
  then
    v_factura_id := new.factura_compra_id;
    v_nuevo := coalesce(new.monto, 0) + coalesce(new.retencion_ganancias_monto, 0);
  else
    return new;
  end if;

  if v_nuevo < 0 then
    raise exception 'La aplicación a una factura de compra no puede ser negativa' using errcode = '22023';
  end if;

  select total into v_total
  from public.facturas_compra
  where id = v_factura_id
  for update;
  if not found then
    raise exception 'No existe la factura de compra a aplicar' using errcode = '23503';
  end if;

  select coalesce(sum(a.monto), 0) into v_aplicado
  from public.op_facturas_compra a
  join public.ordenes_pago op on op.id = a.orden_pago_id
  where a.factura_compra_id = v_factura_id
    and op.estado <> 'anulada'
    and not (
      tg_table_name = 'op_facturas_compra'
      and tg_op = 'UPDATE'
      and a.orden_pago_id = v_old_orden_pago_id
      and a.factura_compra_id = v_old_factura_id
    );

  v_aplicado := v_aplicado + coalesce((
    select sum(coalesce(m.monto, 0) + coalesce(m.retencion_ganancias_monto, 0))
    from public.movimientos m
    where m.factura_compra_id = v_factura_id
      and m.tipo::text = 'pago'
      and not coalesce(m.anulado, false)
      and not (
        tg_table_name = 'movimientos'
        and tg_op = 'UPDATE'
        and m.id = v_old_movimiento_id
      )
  ), 0);

  if v_aplicado + v_nuevo > v_total + 0.005 then
    raise exception 'La aplicación supera el saldo pendiente de la factura de compra' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists validar_saldo_op_factura_compra on public.op_facturas_compra;
create trigger validar_saldo_op_factura_compra
before insert or update of factura_compra_id, monto on public.op_facturas_compra
for each row execute function public.validar_saldo_aplicacion_factura_compra();

drop trigger if exists validar_saldo_movimiento_factura_compra on public.movimientos;
create trigger validar_saldo_movimiento_factura_compra
before insert or update of factura_compra_id, monto, retencion_ganancias_monto, anulado, tipo on public.movimientos
for each row execute function public.validar_saldo_aplicacion_factura_compra();

create or replace function public.registrar_nota_credito_compra(
  p_sociedad_id uuid,
  p_request_key uuid,
  p_factura_origen_id uuid,
  p_credito_aplicado numeric,
  p_factura jsonb,
  p_items jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_user uuid := auth.uid();
  v_origen public.facturas_compra%rowtype;
  v_existente public.facturas_compra%rowtype;
  v_nc_id uuid;
  v_movimiento_id uuid;
  v_numero text;
  v_tipo text;
  v_fecha date;
  v_fecha_vencimiento date;
  v_subtotal numeric;
  v_iva_porcentaje numeric;
  v_iva numeric;
  v_percepciones numeric;
  v_total numeric;
  v_pagado numeric := 0;
  v_saldo numeric;
  v_item jsonb;
  v_descripcion text;
  v_cantidad numeric;
  v_precio numeric;
  v_descuento numeric;
  v_item_iva numeric;
begin
  if v_user is null
    or not exists (
      select 1 from public.profiles
      where id = v_user and role::text in ('super_admin', 'admin', 'administrativo')
    )
    or not exists (
      select 1 from public.user_sociedades
      where user_id = v_user and sociedad_id = p_sociedad_id
    )
  then
    raise exception 'No tenés autorización para registrar notas de crédito en esta sociedad' using errcode = '42501';
  end if;

  if p_sociedad_id is null or p_request_key is null or p_factura_origen_id is null
    or p_credito_aplicado is null or p_credito_aplicado <= 0
    or p_factura is null or jsonb_typeof(p_factura) <> 'object'
    or p_items is null or jsonb_typeof(p_items) <> 'array'
    or jsonb_array_length(p_items) > 500
  then
    raise exception 'Datos incompletos para registrar la nota de crédito' using errcode = '22023';
  end if;

  begin
    v_numero := btrim(coalesce(p_factura->>'numero_factura', ''));
    v_tipo := upper(btrim(coalesce(p_factura->>'tipo_comprobante', '')));
    v_fecha := (p_factura->>'fecha')::date;
    v_fecha_vencimiento := nullif(p_factura->>'fecha_vencimiento', '')::date;
    v_subtotal := (p_factura->>'subtotal')::numeric;
    v_iva_porcentaje := (p_factura->>'iva_porcentaje')::numeric;
    v_iva := (p_factura->>'iva')::numeric;
    v_percepciones := (p_factura->>'percepciones')::numeric;
    v_total := (p_factura->>'total')::numeric;
  exception when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range then
    raise exception 'Los datos de la nota de crédito tienen un formato inválido' using errcode = '22023';
  end;

  if v_numero = '' or v_tipo not in ('NC A', 'NC B', 'NC C', 'NC')
    or v_total <= 0 or v_subtotal < 0 or v_iva < 0 or v_percepciones < 0
    or v_iva_porcentaje < 0 or v_iva_porcentaje > 100
    or p_credito_aplicado > v_total + 0.005
  then
    raise exception 'Los importes o el tipo de la nota de crédito son inválidos' using errcode = '22023';
  end if;

  -- Serializa reintentos simultáneos de la misma solicitud para que ambos
  -- converjan en la misma fila idempotente.
  perform pg_advisory_xact_lock(
    hashtextextended(p_sociedad_id::text || ':' || p_request_key::text, 0)
  );

  select * into v_existente
  from public.facturas_compra
  where sociedad_id = p_sociedad_id and credito_request_key = p_request_key
  for update;
  if found then
    if v_existente.factura_origen_id is distinct from p_factura_origen_id
      or v_existente.credito_aplicado is distinct from round(p_credito_aplicado, 2)
      or v_existente.numero_factura is distinct from v_numero
      or v_existente.proveedor_id::text is distinct from p_factura->>'proveedor_id'
      or v_existente.moneda::text is distinct from p_factura->>'moneda'
      or v_existente.credito_request_payload is distinct from jsonb_build_object(
        'factura', p_factura,
        'items', p_items,
        'factura_origen_id', p_factura_origen_id,
        'credito_aplicado', round(p_credito_aplicado, 2)
      )
    then
      raise exception 'La clave de registro ya fue usada con otra nota de crédito' using errcode = '22023';
    end if;
    return jsonb_build_object(
      'factura_compra_id', v_existente.id,
      'factura_origen_id', v_existente.factura_origen_id,
      'credito_aplicado', v_existente.credito_aplicado,
      'replayed', true
    );
  end if;

  select * into v_origen
  from public.facturas_compra
  where id = p_factura_origen_id and sociedad_id = p_sociedad_id
  for update;
  if not found then
    raise exception 'No se encontró la factura origen en la sociedad seleccionada' using errcode = '22023';
  end if;
  if v_origen.proveedor_id::text is distinct from p_factura->>'proveedor_id'
    or v_origen.moneda::text is distinct from p_factura->>'moneda'
    or upper(coalesce(v_origen.tipo_comprobante, '')) like 'NC%'
    or v_origen.estado = 'anulada'
  then
    raise exception 'La factura origen debe ser activa y de la misma sociedad, proveedor y moneda' using errcode = '22023';
  end if;

  select coalesce(sum(a.monto), 0) into v_pagado
  from public.op_facturas_compra a
  join public.ordenes_pago op on op.id = a.orden_pago_id
  where a.factura_compra_id = v_origen.id and op.estado <> 'anulada';
  v_pagado := v_pagado + coalesce((
    select sum(coalesce(m.monto, 0) + coalesce(m.retencion_ganancias_monto, 0))
    from public.movimientos m
    where m.factura_compra_id = v_origen.id
      and m.tipo::text = 'pago'
      and not coalesce(m.anulado, false)
  ), 0);
  v_saldo := round(v_origen.total - v_pagado, 2);
  if p_credito_aplicado > v_saldo + 0.005 then
    raise exception 'El crédito supera el saldo acreditable restante (%)', v_saldo using errcode = '23514';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(v_item) <> 'object'
      or jsonb_typeof(v_item->'cantidad') <> 'number'
      or jsonb_typeof(v_item->'precio_unitario') <> 'number'
      or jsonb_typeof(v_item->'descuento_porcentaje') <> 'number'
      or jsonb_typeof(v_item->'iva_porcentaje') <> 'number'
    then
      raise exception 'Un ítem de la nota de crédito tiene formato inválido' using errcode = '22023';
    end if;
    v_descripcion := btrim(coalesce(v_item->>'descripcion', ''));
    v_cantidad := (v_item->>'cantidad')::numeric;
    v_precio := (v_item->>'precio_unitario')::numeric;
    v_descuento := (v_item->>'descuento_porcentaje')::numeric;
    v_item_iva := (v_item->>'iva_porcentaje')::numeric;
    if v_descripcion = '' or v_cantidad <= 0 or v_precio < 0
      or v_descuento < 0 or v_descuento > 100 or v_item_iva < 0 or v_item_iva > 100
    then
      raise exception 'Un ítem de la nota de crédito tiene valores inválidos' using errcode = '22023';
    end if;
  end loop;

  insert into public.facturas_compra (
    numero_factura, tipo_comprobante, proveedor_id, fecha, fecha_vencimiento,
    subtotal, iva_porcentaje, iva, percepciones, total, moneda, estado, tipo,
    solo_iva, notas, cae, sociedad_id, created_by, factura_origen_id,
    credito_aplicado, credito_request_key, credito_request_payload
  ) values (
    v_numero, v_tipo, v_origen.proveedor_id, v_fecha, v_fecha_vencimiento,
    v_subtotal, v_iva_porcentaje, v_iva, v_percepciones, v_total, v_origen.moneda,
    'recibida', coalesce(nullif(p_factura->>'tipo', ''), 'mercaderia'),
    coalesce((p_factura->>'solo_iva')::boolean, false), nullif(p_factura->>'notas', ''),
    nullif(p_factura->>'cae', ''), p_sociedad_id, v_user, v_origen.id,
    round(p_credito_aplicado, 2), p_request_key, jsonb_build_object(
      'factura', p_factura,
      'items', p_items,
      'factura_origen_id', p_factura_origen_id,
      'credito_aplicado', round(p_credito_aplicado, 2)
    )
  ) returning id into v_nc_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    insert into public.facturas_compra_items (
      factura_compra_id, producto_id, codigo, descripcion, cantidad,
      precio_unitario, descuento_porcentaje, unidad, iva_porcentaje, sociedad_id
    ) values (
      v_nc_id, null, nullif(v_item->>'codigo', ''), btrim(v_item->>'descripcion'),
      (v_item->>'cantidad')::numeric, (v_item->>'precio_unitario')::numeric,
      (v_item->>'descuento_porcentaje')::numeric,
      coalesce(nullif(v_item->>'unidad', ''), 'u'),
      (v_item->>'iva_porcentaje')::numeric, p_sociedad_id
    );
  end loop;

  insert into public.movimientos (
    tipo, proveedor_id, factura_compra_id, nota_credito_compra_id, monto,
    moneda, fecha, descripcion, conciliado, sociedad_id, created_by
  ) values (
    'pago', v_origen.proveedor_id, v_origen.id, v_nc_id, round(p_credito_aplicado, 2),
    v_origen.moneda, v_fecha, 'Nota de crédito ' || v_tipo || ' ' || v_numero ||
      ' aplicada a ' || coalesce(v_origen.numero_factura, v_origen.id::text),
    true, p_sociedad_id, v_user
  ) returning id into v_movimiento_id;

  update public.facturas_compra
  set total_acreditado = round(coalesce(total_acreditado, 0) + p_credito_aplicado, 2),
      estado = case when v_saldo - p_credito_aplicado <= 0.005 then 'pagada' else estado end
  where id = v_origen.id and sociedad_id = p_sociedad_id;

  return jsonb_build_object(
    'factura_compra_id', v_nc_id,
    'factura_origen_id', v_origen.id,
    'movimiento_id', v_movimiento_id,
    'credito_aplicado', round(p_credito_aplicado, 2),
    'saldo_restante', greatest(0, round(v_saldo - p_credito_aplicado, 2)),
    'replayed', false
  );
end;
$$;

create or replace function public.anular_nota_credito_compra(
  p_sociedad_id uuid,
  p_nota_credito_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_user uuid := auth.uid();
  v_nc public.facturas_compra%rowtype;
  v_origen public.facturas_compra%rowtype;
  v_pagado numeric := 0;
begin
  if v_user is null
    or not exists (
      select 1 from public.profiles
      where id = v_user and role::text in ('super_admin', 'admin', 'administrativo')
    )
    or not exists (
      select 1 from public.user_sociedades
      where user_id = v_user and sociedad_id = p_sociedad_id
    )
  then
    raise exception 'No tenés autorización para anular esta nota de crédito' using errcode = '42501';
  end if;

  select * into v_nc from public.facturas_compra
  where id = p_nota_credito_id and sociedad_id = p_sociedad_id
  for update;
  if not found or v_nc.factura_origen_id is null or v_nc.credito_aplicado <= 0 then
    raise exception 'No se encontró una nota de crédito aplicada' using errcode = '22023';
  end if;
  if v_nc.estado = 'anulada' then
    return jsonb_build_object('factura_compra_id', v_nc.id, 'replayed', true);
  end if;

  select * into v_origen from public.facturas_compra
  where id = v_nc.factura_origen_id and sociedad_id = p_sociedad_id
  for update;
  if not found then raise exception 'No se encontró la factura origen' using errcode = '22023'; end if;

  update public.movimientos
  set monto_original = coalesce(monto_original, monto), monto = 0,
      anulado = true, anulado_at = now(), anulado_por = v_user
  where nota_credito_compra_id = v_nc.id and sociedad_id = p_sociedad_id
    and not coalesce(anulado, false);
  if not found then
    raise exception 'No se encontró la aplicación contable de la nota de crédito' using errcode = '55000';
  end if;

  update public.facturas_compra
  set total_acreditado = greatest(0, round(coalesce(total_acreditado, 0) - v_nc.credito_aplicado, 2))
  where id = v_origen.id and sociedad_id = p_sociedad_id;

  select coalesce(sum(a.monto), 0) into v_pagado
  from public.op_facturas_compra a
  join public.ordenes_pago op on op.id = a.orden_pago_id
  where a.factura_compra_id = v_origen.id and op.estado <> 'anulada';
  v_pagado := v_pagado + coalesce((
    select sum(coalesce(m.monto, 0) + coalesce(m.retencion_ganancias_monto, 0))
    from public.movimientos m
    where m.factura_compra_id = v_origen.id and m.tipo::text = 'pago'
      and not coalesce(m.anulado, false)
  ), 0);

  update public.facturas_compra
  set estado = case
    when v_pagado >= total - 0.005 then 'pagada'
    when estado = 'pagada' then 'recibida'
    else estado
  end
  where id = v_origen.id and sociedad_id = p_sociedad_id;
  update public.facturas_compra set estado = 'anulada'
  where id = v_nc.id and sociedad_id = p_sociedad_id;

  return jsonb_build_object('factura_compra_id', v_nc.id, 'factura_origen_id', v_origen.id, 'replayed', false);
end;
$$;

revoke all on function public.registrar_nota_credito_compra(uuid,uuid,uuid,numeric,jsonb,jsonb) from public, anon;
revoke all on function public.anular_nota_credito_compra(uuid,uuid) from public, anon;
grant execute on function public.registrar_nota_credito_compra(uuid,uuid,uuid,numeric,jsonb,jsonb) to authenticated;
grant execute on function public.anular_nota_credito_compra(uuid,uuid) to authenticated;

comment on column public.movimientos.nota_credito_compra_id is
  'Aplicación no monetaria de una nota de crédito de proveedor; reduce deuda pero no representa salida de caja.';
