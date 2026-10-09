-- Notas de crédito de proveedores con saldo propio (Tarea 6).
--
-- Cambios ADITIVOS (no toca datos existentes):
--  1. Una NC de proveedor puede cargarse SIN factura asociada (queda como crédito disponible)
--     o aplicada a UNA O VARIAS facturas. Lo que no se aplica queda disponible, no se pierde.
--     Disponible de una NC = total − aplicaciones vigentes (movimientos con nota_credito_compra_id).
--  2. En la Orden de Pago se pueden usar NC disponibles: se aplican a las facturas elegidas y
--     el pago en dinero es solo la diferencia. Todo en una sola transacción.
--  3. Anular una NC revierte todas sus aplicaciones.
-- Las funciones anteriores (registrar_nota_credito_compra, registrar_pago_proveedor_seguro) siguen igual.
-- Para deshacer: supabase/rollback/20261009230000_nc_compra_saldo.sql

alter table public.movimientos add column if not exists nc_request_key uuid;
create index if not exists movimientos_nc_request_key_idx on public.movimientos (nc_request_key) where nc_request_key is not null;

-- Qué NC se usaron en cada OP (para mostrarlo en la OP y en la cuenta corriente)
create table if not exists public.op_notas_credito_compra (
  id uuid primary key default gen_random_uuid(),
  sociedad_id uuid not null references public.sociedades(id),
  orden_pago_id uuid references public.ordenes_pago(id) on delete cascade,
  request_key uuid not null,
  nota_credito_compra_id uuid not null references public.facturas_compra(id) on delete restrict,
  factura_compra_id uuid not null references public.facturas_compra(id) on delete restrict,
  movimiento_id uuid references public.movimientos(id) on delete set null,
  monto numeric(15,2) not null check (monto > 0),
  created_at timestamptz not null default now()
);
create index if not exists op_nc_compra_op_idx on public.op_notas_credito_compra (orden_pago_id);
create index if not exists op_nc_compra_nc_idx on public.op_notas_credito_compra (nota_credito_compra_id);
alter table public.op_notas_credito_compra enable row level security;
drop policy if exists op_nc_compra_select on public.op_notas_credito_compra;
create policy op_nc_compra_select on public.op_notas_credito_compra for select to authenticated
  using (public.get_my_role() = any (array['super_admin','admin','administrativo','vendedor','viewer']::public.user_role[]));

-- Disponible de una NC (total − aplicaciones vigentes)
create or replace function public.nc_compra_disponible(p_nc_id uuid)
returns numeric language sql stable security definer set search_path = pg_catalog as $$
  select round(f.total - coalesce((
    select sum(m.monto) from public.movimientos m
    where m.nota_credito_compra_id = f.id and not coalesce(m.anulado, false)
  ), 0), 2)
  from public.facturas_compra f where f.id = p_nc_id;
$$;
grant execute on function public.nc_compra_disponible(uuid) to authenticated;

-- Aplicación interna: valida disponible de la NC y saldo de la factura, y registra el movimiento.
create or replace function public._aplicar_nc_compra(
  p_sociedad_id uuid, p_nc_id uuid, p_factura_id uuid, p_monto numeric, p_fecha date, p_user uuid, p_request_key uuid
) returns uuid
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_nc public.facturas_compra%rowtype;
  v_f public.facturas_compra%rowtype;
  v_disponible numeric;
  v_pagado numeric;
  v_saldo numeric;
  v_mov uuid;
begin
  if p_monto is null or p_monto <= 0 then
    raise exception 'El importe a aplicar de la nota de crédito debe ser mayor que cero' using errcode = '22023';
  end if;
  select * into v_nc from public.facturas_compra where id = p_nc_id and sociedad_id = p_sociedad_id for update;
  if not found or upper(coalesce(v_nc.tipo_comprobante, '')) not like 'NC%' or v_nc.estado = 'anulada' then
    raise exception 'La nota de crédito no existe o está anulada' using errcode = '22023';
  end if;
  v_disponible := public.nc_compra_disponible(p_nc_id);
  if p_monto > v_disponible + 0.005 then
    raise exception 'La nota de crédito % solo tiene % disponibles', v_nc.numero_factura, v_disponible using errcode = '23514';
  end if;

  select * into v_f from public.facturas_compra where id = p_factura_id and sociedad_id = p_sociedad_id for update;
  if not found or v_f.proveedor_id is distinct from v_nc.proveedor_id or v_f.moneda is distinct from v_nc.moneda
    or upper(coalesce(v_f.tipo_comprobante, '')) like 'NC%' or v_f.estado = 'anulada' then
    raise exception 'La factura debe estar activa y ser del mismo proveedor y moneda que la nota de crédito' using errcode = '22023';
  end if;

  select coalesce(sum(a.monto), 0) into v_pagado
  from public.op_facturas_compra a join public.ordenes_pago op on op.id = a.orden_pago_id
  where a.factura_compra_id = v_f.id and op.estado <> 'anulada';
  v_pagado := v_pagado + coalesce((
    select sum(coalesce(m.monto, 0) + coalesce(m.retencion_ganancias_monto, 0))
    from public.movimientos m
    where m.factura_compra_id = v_f.id and m.tipo::text = 'pago' and not coalesce(m.anulado, false)
  ), 0);
  v_saldo := round(v_f.total - v_pagado, 2);
  if p_monto > v_saldo + 0.005 then
    raise exception 'La factura % tiene saldo % y no admite aplicar %', v_f.numero_factura, v_saldo, p_monto using errcode = '23514';
  end if;

  insert into public.movimientos (
    tipo, proveedor_id, factura_compra_id, nota_credito_compra_id, monto,
    moneda, fecha, descripcion, conciliado, sociedad_id, created_by, nc_request_key
  ) values (
    'pago', v_f.proveedor_id, v_f.id, v_nc.id, round(p_monto, 2), v_f.moneda::public.moneda_type, coalesce(p_fecha, current_date),
    'Nota de crédito ' || coalesce(v_nc.tipo_comprobante, 'NC') || ' ' || coalesce(v_nc.numero_factura, '') ||
      ' aplicada a ' || coalesce(v_f.numero_factura, v_f.id::text),
    true, p_sociedad_id, p_user, p_request_key
  ) returning id into v_mov;

  update public.facturas_compra
  set total_acreditado = round(coalesce(total_acreditado, 0) + p_monto, 2),
      estado = case when v_saldo - p_monto <= 0.005 then 'pagada' else estado end
  where id = v_f.id;

  update public.facturas_compra
  set credito_aplicado = round(coalesce(credito_aplicado, 0) + p_monto, 2),
      factura_origen_id = coalesce(factura_origen_id, v_f.id)
  where id = v_nc.id;

  return v_mov;
end;
$$;
revoke all on function public._aplicar_nc_compra(uuid, uuid, uuid, numeric, date, uuid, uuid) from public, anon, authenticated;

-- Carga de NC de proveedor: sin factura (crédito disponible) o aplicada a una o varias facturas.
-- p_aplicaciones: [{factura_compra_id, monto}] (puede ser vacío)
create or replace function public.registrar_nota_credito_compra_v2(
  p_sociedad_id uuid,
  p_request_key uuid,
  p_factura jsonb,
  p_items jsonb,
  p_aplicaciones jsonb
) returns jsonb
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_user uuid := auth.uid();
  v_existente public.facturas_compra%rowtype;
  v_nc_id uuid;
  v_proveedor uuid;
  v_moneda text;
  v_numero text;
  v_tipo text;
  v_total numeric;
  v_item jsonb;
  v_ap jsonb;
  v_suma numeric := 0;
begin
  if v_user is null
    or not exists (select 1 from public.profiles where id = v_user and active and role::text in ('super_admin','admin','administrativo','vendedor'))
    or not exists (select 1 from public.user_sociedades where user_id = v_user and sociedad_id = p_sociedad_id)
  then
    raise exception 'No tenés autorización para registrar notas de crédito en esta sociedad' using errcode = '42501';
  end if;
  if p_sociedad_id is null or p_request_key is null or p_factura is null or jsonb_typeof(p_factura) <> 'object'
    or p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 500
    or (p_aplicaciones is not null and jsonb_typeof(p_aplicaciones) <> 'array')
  then
    raise exception 'Datos incompletos para registrar la nota de crédito' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_sociedad_id::text || ':' || p_request_key::text, 0));
  select * into v_existente from public.facturas_compra
  where sociedad_id = p_sociedad_id and credito_request_key = p_request_key;
  if found then
    return jsonb_build_object('factura_compra_id', v_existente.id, 'disponible', public.nc_compra_disponible(v_existente.id), 'replayed', true);
  end if;

  v_proveedor := nullif(p_factura->>'proveedor_id', '')::uuid;
  v_moneda := coalesce(nullif(p_factura->>'moneda', ''), 'ARS');
  v_numero := btrim(coalesce(p_factura->>'numero_factura', ''));
  v_tipo := upper(btrim(coalesce(p_factura->>'tipo_comprobante', 'NC')));
  v_total := (p_factura->>'total')::numeric;
  if v_proveedor is null or not exists (select 1 from public.proveedores where id = v_proveedor) then
    raise exception 'Elegí el proveedor de la nota de crédito' using errcode = '22023';
  end if;
  if v_numero = '' or v_tipo not in ('NC A','NC B','NC C','NC','NC FCE A','NC FCE B') or v_total is null or v_total <= 0
    or v_moneda not in ('ARS','USD') then
    raise exception 'El número, el tipo o el total de la nota de crédito son inválidos' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.facturas_compra
    where sociedad_id = p_sociedad_id and proveedor_id = v_proveedor and estado <> 'anulada'
      and upper(coalesce(tipo_comprobante, '')) = v_tipo
      and regexp_replace(numero_factura, '\D', '', 'g') = regexp_replace(v_numero, '\D', '', 'g')
  ) then
    raise exception 'La nota de crédito % de este proveedor ya está cargada', v_numero using errcode = '23505';
  end if;

  insert into public.facturas_compra (
    numero_factura, tipo_comprobante, proveedor_id, fecha, subtotal, iva_porcentaje, iva, percepciones, total,
    moneda, estado, tipo, solo_iva, notas, cae, sociedad_id, created_by, credito_aplicado,
    credito_request_key, credito_request_payload
  ) values (
    v_numero, v_tipo, v_proveedor, coalesce(nullif(p_factura->>'fecha', '')::date, current_date),
    coalesce((p_factura->>'subtotal')::numeric, 0), coalesce((p_factura->>'iva_porcentaje')::numeric, 21),
    coalesce((p_factura->>'iva')::numeric, 0), coalesce((p_factura->>'percepciones')::numeric, 0), v_total,
    v_moneda, 'recibida', coalesce(nullif(p_factura->>'tipo', ''), 'mercaderia'), false,
    nullif(p_factura->>'notas', ''), nullif(p_factura->>'cae', ''), p_sociedad_id, v_user, 0,
    p_request_key, jsonb_build_object('factura', p_factura, 'items', p_items, 'aplicaciones', coalesce(p_aplicaciones, '[]'::jsonb))
  ) returning id into v_nc_id;

  for v_item in select value from jsonb_array_elements(p_items) loop
    if btrim(coalesce(v_item->>'descripcion', '')) = '' then continue; end if;
    insert into public.facturas_compra_items (
      factura_compra_id, codigo, descripcion, cantidad, precio_unitario, descuento_porcentaje, unidad, iva_porcentaje, sociedad_id
    ) values (
      v_nc_id, nullif(v_item->>'codigo', ''), btrim(v_item->>'descripcion'),
      coalesce((v_item->>'cantidad')::numeric, 1), coalesce((v_item->>'precio_unitario')::numeric, 0),
      coalesce((v_item->>'descuento_porcentaje')::numeric, 0), coalesce(nullif(v_item->>'unidad', ''), 'u'),
      coalesce((v_item->>'iva_porcentaje')::numeric, 21), p_sociedad_id
    );
  end loop;

  for v_ap in select value from jsonb_array_elements(coalesce(p_aplicaciones, '[]'::jsonb)) loop
    if coalesce((v_ap->>'monto')::numeric, 0) <= 0 then continue; end if;
    v_suma := v_suma + (v_ap->>'monto')::numeric;
    perform public._aplicar_nc_compra(p_sociedad_id, v_nc_id, (v_ap->>'factura_compra_id')::uuid,
      round((v_ap->>'monto')::numeric, 2), coalesce(nullif(p_factura->>'fecha', '')::date, current_date), v_user, p_request_key);
  end loop;

  return jsonb_build_object('factura_compra_id', v_nc_id, 'aplicado', round(v_suma, 2),
    'disponible', public.nc_compra_disponible(v_nc_id), 'replayed', false);
end;
$$;
revoke all on function public.registrar_nota_credito_compra_v2(uuid, uuid, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.registrar_nota_credito_compra_v2(uuid, uuid, jsonb, jsonb, jsonb) to authenticated;

-- Anular una NC: revierte todas sus aplicaciones y recalcula el estado de cada factura.
create or replace function public.anular_nota_credito_compra_v2(p_sociedad_id uuid, p_nota_credito_id uuid)
returns jsonb
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_user uuid := auth.uid();
  v_nc public.facturas_compra%rowtype;
  v_r record;
  v_pagado numeric;
begin
  if v_user is null
    or not exists (select 1 from public.profiles where id = v_user and role::text in ('super_admin','admin','administrativo'))
    or not exists (select 1 from public.user_sociedades where user_id = v_user and sociedad_id = p_sociedad_id)
  then
    raise exception 'No tenés autorización para anular esta nota de crédito' using errcode = '42501';
  end if;
  select * into v_nc from public.facturas_compra where id = p_nota_credito_id and sociedad_id = p_sociedad_id for update;
  if not found or upper(coalesce(v_nc.tipo_comprobante, '')) not like 'NC%' then
    raise exception 'No se encontró la nota de crédito' using errcode = '22023';
  end if;
  if v_nc.estado = 'anulada' then
    return jsonb_build_object('factura_compra_id', v_nc.id, 'replayed', true);
  end if;

  for v_r in
    select m.factura_compra_id, sum(m.monto) as monto
    from public.movimientos m
    where m.nota_credito_compra_id = v_nc.id and not coalesce(m.anulado, false) and m.factura_compra_id is not null
    group by m.factura_compra_id
  loop
    update public.facturas_compra
    set total_acreditado = greatest(0, round(coalesce(total_acreditado, 0) - v_r.monto, 2))
    where id = v_r.factura_compra_id;
  end loop;

  update public.movimientos
  set monto_original = coalesce(monto_original, monto), monto = 0,
      anulado = true, anulado_at = now(), anulado_por = v_user
  where nota_credito_compra_id = v_nc.id and not coalesce(anulado, false);

  for v_r in select distinct m.factura_compra_id from public.movimientos m
    where m.nota_credito_compra_id = v_nc.id and m.factura_compra_id is not null
  loop
    select coalesce(sum(a.monto), 0) into v_pagado
    from public.op_facturas_compra a join public.ordenes_pago op on op.id = a.orden_pago_id
    where a.factura_compra_id = v_r.factura_compra_id and op.estado <> 'anulada';
    v_pagado := v_pagado + coalesce((
      select sum(coalesce(m.monto, 0) + coalesce(m.retencion_ganancias_monto, 0)) from public.movimientos m
      where m.factura_compra_id = v_r.factura_compra_id and m.tipo::text = 'pago' and not coalesce(m.anulado, false)
    ), 0);
    update public.facturas_compra
    set estado = case when v_pagado >= total - 0.005 then 'pagada' when estado = 'pagada' then 'recibida' else estado end
    where id = v_r.factura_compra_id;
  end loop;

  update public.facturas_compra set estado = 'anulada' where id = v_nc.id;
  return jsonb_build_object('factura_compra_id', v_nc.id, 'replayed', false);
end;
$$;
revoke all on function public.anular_nota_credito_compra_v2(uuid, uuid) from public, anon;
grant execute on function public.anular_nota_credito_compra_v2(uuid, uuid) to authenticated;

-- Orden de pago usando NC: aplica las NC a las facturas y paga en dinero solo la diferencia.
-- p_notas_credito: [{nc_id, factura_compra_id, monto}]. p_facturas y p_monto_bruto = solo la parte en dinero.
-- Si la parte en dinero es 0, solo se aplican las NC (no se crea OP).
create or replace function public.registrar_pago_proveedor_con_nc(
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
  p_notas text,
  p_sobre_verde boolean,
  p_notas_credito jsonb
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_nc jsonb;
  v_mov uuid;
  v_res jsonb := '{}'::jsonb;
  v_ya_aplicado boolean;
  v_detalle text := '';
  v_total_nc numeric := 0;
begin
  if v_user is null
    or not exists (select 1 from public.profiles where id = v_user and role::text in ('super_admin','admin','administrativo'))
    or not exists (select 1 from public.user_sociedades where user_id = v_user and sociedad_id = p_sociedad_id)
  then
    raise exception 'No tenes permiso para pagar en esta sociedad' using errcode = '42501';
  end if;
  if p_notas_credito is null or jsonb_typeof(p_notas_credito) <> 'array' then
    raise exception 'Formato inválido de notas de crédito' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_sociedad_id::text || p_proveedor_id::text, 0));

  -- Idempotencia: si esta solicitud ya aplicó sus NC, no se vuelven a aplicar.
  select exists (select 1 from public.movimientos where nc_request_key = p_request_key and nota_credito_compra_id is not null)
    into v_ya_aplicado;

  if not v_ya_aplicado then
    for v_nc in select value from jsonb_array_elements(p_notas_credito) loop
      if coalesce((v_nc->>'monto')::numeric, 0) <= 0 then continue; end if;
      if not exists (select 1 from public.facturas_compra where id = (v_nc->>'nc_id')::uuid and proveedor_id = p_proveedor_id) then
        raise exception 'La nota de crédito no corresponde a este proveedor' using errcode = '22023';
      end if;
      v_mov := public._aplicar_nc_compra(p_sociedad_id, (v_nc->>'nc_id')::uuid, (v_nc->>'factura_compra_id')::uuid,
        round((v_nc->>'monto')::numeric, 2), p_fecha, v_user, p_request_key);
      insert into public.op_notas_credito_compra (sociedad_id, request_key, nota_credito_compra_id, factura_compra_id, movimiento_id, monto)
      values (p_sociedad_id, p_request_key, (v_nc->>'nc_id')::uuid, (v_nc->>'factura_compra_id')::uuid, v_mov, round((v_nc->>'monto')::numeric, 2));
      v_total_nc := v_total_nc + round((v_nc->>'monto')::numeric, 2);
    end loop;
  end if;

  select string_agg(coalesce(nc.tipo_comprobante, 'NC') || ' ' || nc.numero_factura || ' → ' || coalesce(f.numero_factura, '') || ': ' || o.monto::text, '; ')
    into v_detalle
  from public.op_notas_credito_compra o
  join public.facturas_compra nc on nc.id = o.nota_credito_compra_id
  join public.facturas_compra f on f.id = o.factura_compra_id
  where o.request_key = p_request_key;

  if coalesce(p_monto_bruto, 0) > 0 then
    v_res := public.registrar_pago_proveedor_seguro(
      p_sociedad_id, p_request_key, p_modo, p_proveedor_id, p_fecha, p_moneda, p_facturas, p_medios,
      p_monto_bruto, p_base_retencion, p_retencion_pct, p_retencion_monto,
      trim(both from coalesce(p_notas, '') || case when v_detalle is not null then E'\nNC aplicadas: ' || v_detalle else '' end),
      p_sobre_verde
    );
    if v_res ? 'orden_pago_id' then
      update public.op_notas_credito_compra set orden_pago_id = (v_res->>'orden_pago_id')::uuid
      where request_key = p_request_key and orden_pago_id is null;
    end if;
  end if;

  return v_res || jsonb_build_object('notas_credito_aplicadas', coalesce(v_detalle, ''), 'solo_nc', coalesce(p_monto_bruto, 0) <= 0);
end;
$$;
revoke all on function public.registrar_pago_proveedor_con_nc(uuid, uuid, text, uuid, date, text, jsonb, jsonb, numeric, numeric, numeric, numeric, text, boolean, jsonb) from public, anon;
grant execute on function public.registrar_pago_proveedor_con_nc(uuid, uuid, text, uuid, date, text, jsonb, jsonb, numeric, numeric, numeric, numeric, text, boolean, jsonb) to authenticated;
