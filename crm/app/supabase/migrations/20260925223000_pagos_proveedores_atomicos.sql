-- Pagos ARS a proveedores: pago directo y OP comparten una unica escritura
-- transaccional, con saldos recalculados bajo lock e idempotencia por request.
begin;

alter table public.movimientos
  add column if not exists orden_pago_id uuid references public.ordenes_pago(id) on delete set null;

alter table public.ordenes_pago
  add column if not exists saldo_a_favor numeric(20,2) not null default 0
    check (saldo_a_favor >= 0);

create table if not exists public.pago_solicitudes (
  id uuid primary key default gen_random_uuid(),
  sociedad_id uuid not null references public.sociedades(id),
  request_key uuid not null,
  modo text not null check (modo in ('directo', 'op')),
  proveedor_id uuid not null references public.proveedores(id),
  created_by uuid not null references public.profiles(id),
  payload jsonb not null,
  resultado jsonb,
  created_at timestamptz not null default now(),
  unique (sociedad_id, request_key)
);

create table if not exists public.saldos_favor_proveedor (
  id uuid primary key default gen_random_uuid(),
  sociedad_id uuid not null references public.sociedades(id),
  proveedor_id uuid not null references public.proveedores(id),
  orden_pago_id uuid not null unique references public.ordenes_pago(id),
  moneda text not null check (moneda in ('ARS', 'USD')),
  monto_original numeric(20,2) not null check (monto_original > 0),
  saldo numeric(20,2) not null check (saldo >= 0 and saldo <= monto_original),
  estado text not null default 'disponible' check (estado in ('disponible', 'aplicado', 'anulado')),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists saldos_favor_proveedor_disponibles_idx
  on public.saldos_favor_proveedor (sociedad_id, proveedor_id, moneda)
  where estado = 'disponible' and saldo > 0;

alter table public.pago_solicitudes enable row level security;
alter table public.saldos_favor_proveedor enable row level security;
revoke all on public.pago_solicitudes, public.saldos_favor_proveedor from anon, authenticated;
grant select on public.pago_solicitudes, public.saldos_favor_proveedor to authenticated;

drop policy if exists pago_solicitudes_read on public.pago_solicitudes;
create policy pago_solicitudes_read on public.pago_solicitudes
  for select to authenticated using (
    not exists (
      select 1 from public.user_sociedades us
      where us.user_id = auth.uid()
    )
    or exists (
      select 1 from public.user_sociedades us
      where us.user_id = auth.uid()
        and us.sociedad_id = pago_solicitudes.sociedad_id
    )
  );

drop policy if exists saldos_favor_proveedor_read on public.saldos_favor_proveedor;
create policy saldos_favor_proveedor_read on public.saldos_favor_proveedor
  for select to authenticated using (
    not exists (
      select 1 from public.user_sociedades us
      where us.user_id = auth.uid()
    )
    or exists (
      select 1 from public.user_sociedades us
      where us.user_id = auth.uid()
        and us.sociedad_id = saldos_favor_proveedor.sociedad_id
    )
  );

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
    if p_modo = 'directo' and v_aplicar >= v_saldo then
      raise exception 'El pago directo debe ser parcial; para cancelar la factura use una OP';
    end if;

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
      'Pago parcial directo - ' || coalesce(v_factura->>'numero_factura', 'FC'),
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
        'Pago parcial directo - Ret. Ganancias - ' || coalesce(v_factura->>'numero_factura', 'FC'),
        true, p_sociedad_id, auth.uid(), coalesce(p_base_retencion, 0),
        coalesce(p_retencion_pct, 0), coalesce(p_retencion_monto, 0)
      );
    end if;

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

create or replace function public.anular_saldo_favor_op()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.estado = 'anulada' and old.estado <> 'anulada' then
    update public.saldos_favor_proveedor
    set saldo = 0, estado = 'anulado', updated_at = now()
    where orden_pago_id = new.id and estado <> 'anulado';
  end if;
  return new;
end;
$$;

drop trigger if exists orden_pago_anula_saldo_favor on public.ordenes_pago;
create trigger orden_pago_anula_saldo_favor
  after update of estado on public.ordenes_pago
  for each row execute function public.anular_saldo_favor_op();

comment on column public.ordenes_pago.saldo_a_favor is
  'Excedente efectivamente entregado por encima del neto; genera un credito trazable del comprador.';
comment on table public.saldos_favor_proveedor is
  'Creditos explicitos originados por sobrepagos de OP, anulados junto con la OP.';

commit;
