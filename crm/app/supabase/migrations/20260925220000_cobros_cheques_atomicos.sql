-- Cobros ARS idempotentes: el movimiento, la cuenta corriente y los cheques
-- recibidos se confirman (o se revierten) en la misma transaccion PostgreSQL.
begin;

alter table public.echeqs
  add column if not exists fecha_emision date;

comment on column public.echeqs.fecha_emision is
  'Fecha opcional de emisión del cheque, distinta de su fecha de pago o cobro.';

create table if not exists public.cobro_solicitudes (
  id uuid primary key default gen_random_uuid(),
  sociedad_id uuid not null references public.sociedades(id),
  request_key uuid not null,
  tipo text not null check (tipo in ('simple', 'masivo')),
  created_by uuid not null references public.profiles(id),
  payload jsonb not null,
  resultado jsonb,
  created_at timestamptz not null default now(),
  unique (sociedad_id, request_key)
);

alter table public.cobro_solicitudes enable row level security;
revoke all on public.cobro_solicitudes from anon, authenticated;
grant select on public.cobro_solicitudes to authenticated;

drop policy if exists cobro_solicitudes_read on public.cobro_solicitudes;
create policy cobro_solicitudes_read
  on public.cobro_solicitudes
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.user_sociedades us
      where us.user_id = auth.uid()
        and us.sociedad_id = cobro_solicitudes.sociedad_id
    )
  );

create or replace function public.registrar_cobro_seguro(
  p_factura_id uuid,
  p_lineas jsonb,
  p_fecha date,
  p_sociedad_id uuid,
  p_request_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.cobro_solicitudes%rowtype;
  v_payload jsonb;
  v_result jsonb;
  v_cliente_id uuid;
  v_cliente_nombre text;
  v_linea jsonb;
  v_ordinal bigint;
  v_numero text;
begin
  if auth.uid() is null
    or not exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('super_admin', 'admin', 'administrativo')
    )
    or not exists (
      select 1 from public.user_sociedades us
      where us.user_id = auth.uid()
        and us.sociedad_id = p_sociedad_id
    ) then
    raise exception 'No tenes permiso para registrar cobros en esta sociedad';
  end if;

  if p_request_key is null
    or p_factura_id is null
    or p_sociedad_id is null
    or p_fecha is null
    or jsonb_typeof(p_lineas) is distinct from 'array'
    or jsonb_array_length(p_lineas) = 0 then
    raise exception 'Solicitud de cobro incompleta';
  end if;

  select f.cliente_id, c.razon_social
    into v_cliente_id, v_cliente_nombre
  from public.facturas f
  join public.clientes c
    on c.id = f.cliente_id
   and c.sociedad_id = f.sociedad_id
  where f.id = p_factura_id
    and f.sociedad_id = p_sociedad_id;

  if v_cliente_id is null then
    raise exception 'La factura no pertenece a la sociedad activa';
  end if;

  v_payload := jsonb_build_object(
    'tipo', 'simple',
    'factura_id', p_factura_id,
    'fecha', p_fecha,
    'lineas', p_lineas
  );

  -- Una misma llave nunca puede crear dos cobros, aun si el navegador reintenta
  -- luego de perder la respuesta del servidor.
  perform pg_advisory_xact_lock(hashtextextended(p_sociedad_id::text || p_request_key::text, 0));

  select * into v_existing
  from public.cobro_solicitudes
  where sociedad_id = p_sociedad_id
    and request_key = p_request_key;

  if found then
    if v_existing.tipo <> 'simple'
      or v_existing.created_by <> auth.uid()
      or v_existing.payload <> v_payload then
      raise exception 'La solicitud ya existe con otros datos';
    end if;
    return coalesce(v_existing.resultado, '{}'::jsonb) || jsonb_build_object('replayed', true);
  end if;

  insert into public.cobro_solicitudes (
    sociedad_id, request_key, tipo, created_by, payload
  ) values (
    p_sociedad_id, p_request_key, 'simple', auth.uid(), v_payload
  );

  -- Serializa cobros distintos sobre la misma factura para que el saldo que
  -- valida la funcion historica no pueda quedar desactualizado entre requests.
  perform 1
  from public.facturas f
  where f.id = p_factura_id
    and f.sociedad_id = p_sociedad_id
  for update;

  -- La funcion historica conserva el calculo de saldo/estado. Al invocarla
  -- desde este wrapper, sus inserts forman parte de esta misma transaccion.
  v_result := public.registrar_cobro(
    p_factura_id := p_factura_id,
    p_lineas := p_lineas,
    p_fecha := p_fecha,
    p_sociedad_id := p_sociedad_id,
    p_created_by := auth.uid()
  )::jsonb;

  for v_linea, v_ordinal in
    select value, ordinality
    from jsonb_array_elements(p_lineas) with ordinality
  loop
    if coalesce(v_linea->>'tipo', '') in ('cheque_recibido', 'echeq') then
      if coalesce((v_linea->>'monto')::numeric, 0) <= 0 then
        raise exception 'El importe del cheque debe ser mayor a cero';
      end if;

      v_numero := coalesce(
        nullif(trim(v_linea->>'cheque_numero'), ''),
        'CHQ-' || left(replace(p_request_key::text, '-', ''), 12) || '-' || v_ordinal::text
      );

      insert into public.echeqs (
        direccion,
        tipo_cheque,
        numero,
        banco_emisor,
        monto,
        moneda,
        fecha_pago,
        estado,
        origen_tipo,
        origen_id,
        origen_nombre,
        sociedad_id,
        user_id,
        observaciones
      ) values (
        'recibido',
        case when coalesce(v_linea->>'tipo_cheque', '') = 'echeq' then 'echeq' else 'fisico' end,
        v_numero,
        nullif(trim(v_linea->>'cheque_banco'), ''),
        (v_linea->>'monto')::numeric,
        'ARS',
        coalesce(nullif(v_linea->>'cheque_fecha_pago', '')::date, p_fecha),
        'en_cartera',
        'cliente',
        v_cliente_id,
        v_cliente_nombre,
        p_sociedad_id,
        auth.uid(),
        nullif(trim(concat_ws(' | ', v_linea->>'descripcion',
          case when nullif(trim(v_linea->>'cheque_id_digital'), '') is not null
            then 'ID digital: ' || trim(v_linea->>'cheque_id_digital') end)), '')
      );
    end if;
  end loop;

  if jsonb_typeof(v_result) is distinct from 'object' then
    v_result := jsonb_build_object('resultado', v_result);
  end if;
  v_result := coalesce(v_result, '{}'::jsonb)
    || jsonb_build_object('request_key', p_request_key, 'replayed', false);

  update public.cobro_solicitudes
  set resultado = v_result
  where sociedad_id = p_sociedad_id
    and request_key = p_request_key;

  return v_result;
end;
$$;

create or replace function public.registrar_cobro_masivo_seguro(
  p_cliente_id uuid,
  p_facturas jsonb,
  p_medios jsonb,
  p_retenciones jsonb,
  p_fecha date,
  p_sociedad_id uuid,
  p_request_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.cobro_solicitudes%rowtype;
  v_payload jsonb;
  v_result jsonb;
  v_cliente_nombre text;
  v_medio jsonb;
  v_ordinal bigint;
  v_numero text;
begin
  if auth.uid() is null
    or not exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('super_admin', 'admin', 'administrativo')
    )
    or not exists (
      select 1 from public.user_sociedades us
      where us.user_id = auth.uid()
        and us.sociedad_id = p_sociedad_id
    ) then
    raise exception 'No tenes permiso para registrar cobros en esta sociedad';
  end if;

  if p_request_key is null
    or p_cliente_id is null
    or p_sociedad_id is null
    or p_fecha is null
    or jsonb_typeof(p_facturas) is distinct from 'array'
    or jsonb_array_length(p_facturas) = 0
    or jsonb_typeof(p_medios) is distinct from 'array'
    or jsonb_array_length(p_medios) = 0
    or jsonb_typeof(p_retenciones) is distinct from 'array' then
    raise exception 'Solicitud de cobro masivo incompleta';
  end if;

  select c.razon_social into v_cliente_nombre
  from public.clientes c
  where c.id = p_cliente_id
    and c.sociedad_id = p_sociedad_id;

  if v_cliente_nombre is null then
    raise exception 'El cliente no pertenece a la sociedad activa';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_facturas) item
    left join public.facturas f
      on f.id = (item->>'id')::uuid
     and f.sociedad_id = p_sociedad_id
     and f.cliente_id = p_cliente_id
    where f.id is null
  ) then
    raise exception 'Hay facturas de otro cliente o sociedad';
  end if;

  v_payload := jsonb_build_object(
    'tipo', 'masivo',
    'cliente_id', p_cliente_id,
    'fecha', p_fecha,
    'facturas', p_facturas,
    'medios', p_medios,
    'retenciones', p_retenciones
  );

  perform pg_advisory_xact_lock(hashtextextended(p_sociedad_id::text || p_request_key::text, 0));

  select * into v_existing
  from public.cobro_solicitudes
  where sociedad_id = p_sociedad_id
    and request_key = p_request_key;

  if found then
    if v_existing.tipo <> 'masivo'
      or v_existing.created_by <> auth.uid()
      or v_existing.payload <> v_payload then
      raise exception 'La solicitud ya existe con otros datos';
    end if;
    return coalesce(v_existing.resultado, '{}'::jsonb) || jsonb_build_object('replayed', true);
  end if;

  insert into public.cobro_solicitudes (
    sociedad_id, request_key, tipo, created_by, payload
  ) values (
    p_sociedad_id, p_request_key, 'masivo', auth.uid(), v_payload
  );

  -- El orden estable evita interbloqueos si dos liquidaciones incluyen varias
  -- facturas del mismo cliente al mismo tiempo.
  perform f.id
  from jsonb_array_elements(p_facturas) item
  join public.facturas f
    on f.id = (item->>'id')::uuid
   and f.sociedad_id = p_sociedad_id
   and f.cliente_id = p_cliente_id
  order by f.id
  for update of f;

  v_result := public.registrar_cobro_masivo(
    p_cliente_id := p_cliente_id,
    p_facturas := p_facturas,
    p_medios := p_medios,
    p_retenciones := p_retenciones,
    p_fecha := p_fecha,
    p_sociedad_id := p_sociedad_id,
    p_created_by := auth.uid()
  )::jsonb;

  for v_medio, v_ordinal in
    select value, ordinality
    from jsonb_array_elements(p_medios) with ordinality
  loop
    if coalesce(v_medio->>'tipo', '') in ('cheque_recibido', 'echeq') then
      if coalesce((v_medio->>'monto')::numeric, 0) <= 0 then
        raise exception 'El importe del cheque debe ser mayor a cero';
      end if;

      v_numero := coalesce(
        nullif(trim(v_medio->>'cheque_numero'), ''),
        'CHQ-' || left(replace(p_request_key::text, '-', ''), 12) || '-' || v_ordinal::text
      );

      insert into public.echeqs (
        direccion,
        tipo_cheque,
        numero,
        banco_emisor,
        monto,
        moneda,
        fecha_pago,
        estado,
        origen_tipo,
        origen_id,
        origen_nombre,
        sociedad_id,
        user_id,
        observaciones
      ) values (
        'recibido',
        case when coalesce(v_medio->>'tipo_cheque', '') = 'echeq' then 'echeq' else 'fisico' end,
        v_numero,
        nullif(trim(v_medio->>'cheque_banco'), ''),
        (v_medio->>'monto')::numeric,
        'ARS',
        coalesce(nullif(v_medio->>'cheque_fecha_pago', '')::date, p_fecha),
        'en_cartera',
        'cliente',
        p_cliente_id,
        v_cliente_nombre,
        p_sociedad_id,
        auth.uid(),
        nullif(trim(v_medio->>'descripcion'), '')
      );
    end if;
  end loop;

  if jsonb_typeof(v_result) is distinct from 'object' then
    v_result := jsonb_build_object('resultado', v_result);
  end if;
  v_result := coalesce(v_result, '{}'::jsonb)
    || jsonb_build_object('request_key', p_request_key, 'replayed', false);

  update public.cobro_solicitudes
  set resultado = v_result
  where sociedad_id = p_sociedad_id
    and request_key = p_request_key;

  return v_result;
end;
$$;

revoke all on function public.registrar_cobro_seguro(uuid, jsonb, date, uuid, uuid) from public, anon;
grant execute on function public.registrar_cobro_seguro(uuid, jsonb, date, uuid, uuid) to authenticated;
revoke all on function public.registrar_cobro_masivo_seguro(uuid, jsonb, jsonb, jsonb, date, uuid, uuid) from public, anon;
grant execute on function public.registrar_cobro_masivo_seguro(uuid, jsonb, jsonb, jsonb, date, uuid, uuid) to authenticated;

-- Los clientes actualizados usan exclusivamente los wrappers atomicos. Se
-- revoca el acceso directo a las funciones historicas para fallar cerrado en
-- clientes viejos, en vez de volver a crear un cobro sin su cheque en cartera.
do $$
declare
  v_function regprocedure;
begin
  for v_function in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('registrar_cobro', 'registrar_cobro_masivo')
  loop
    execute 'revoke execute on function ' || v_function || ' from public, anon, authenticated';
  end loop;
end;
$$;

comment on function public.registrar_cobro_seguro is
  'Registra un cobro ARS y sus cheques recibidos de forma atomica e idempotente.';
comment on function public.registrar_cobro_masivo_seguro is
  'Registra un cobro masivo ARS y sus cheques recibidos de forma atomica e idempotente.';

commit;
