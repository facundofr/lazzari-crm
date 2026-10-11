-- Cobros: fecha real, "conciliado" de verdad y NC manual contra varias facturas (11/10/2026).
--
-- 1) Respaldo de los datos que se corrigen (tabla nueva lz_respaldo_correcciones).
-- 2) Correcciones de datos (no se borra nada):
--    · DEL SOL: cobro con cheque 3881 y su retención de Ganancias tenían la fecha de pago del cheque (20/11/2026);
--      pasan a la fecha en que se cargaron (30/09/2026).
--    · BARRAZA: cobro con cheque 00000131 tenía 16/10/2026; pasa a 18/09/2026.
--      Los tres quedan "pendientes de conciliar" (nunca se cruzaron con un extracto).
--    · Cheque 00000131 de BARRAZA sin cliente: se le carga, para que rechazarlo encuentre su cobro.
--    · Cheques de BARRAZA y DEL SOL atados a su cobro (movimiento_id).
--    · NC A 0015-00000005 de DEL SOL sin factura de origen: se ata a la FA 0015-00000039 que anula.
-- 3) Los cobros nuevos ya no nacen "conciliados": se concilian contra el extracto o a mano.
-- 4) crear_nota_credito_manual_venta_multiple: una NC (hecha en ARCA, con su CAE) que cancela varias facturas.
--    Tabla nueva nota_credito_venta_aplicaciones con cuánto aplica a cada factura.
--
-- Cambios aditivos. Vuelta atrás: supabase/rollback/20261011150000_cobros_fecha_conciliado_nc_multiple.sql
begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Respaldo
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.lz_respaldo_correcciones (
  id bigserial primary key,
  migracion text not null,
  tabla text not null,
  registro_id uuid not null,
  datos_anteriores jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.lz_respaldo_correcciones enable row level security;
revoke all on public.lz_respaldo_correcciones from anon, authenticated;

insert into public.lz_respaldo_correcciones (migracion, tabla, registro_id, datos_anteriores)
select '20261011150000', 'movimientos', m.id,
       jsonb_build_object('fecha', m.fecha, 'conciliado', m.conciliado, 'conciliado_por', m.conciliado_por, 'conciliado_at', m.conciliado_at)
from public.movimientos m
where m.id in ('5066f916-e5e1-44f3-befc-75d1cf7f9544', '815c15e7-32ae-4996-b9f2-7efc9496f4ac', '741c621e-0e43-41bb-8f15-6b68d1014a69')
  and not exists (select 1 from public.lz_respaldo_correcciones r where r.migracion = '20261011150000' and r.registro_id = m.id);

insert into public.lz_respaldo_correcciones (migracion, tabla, registro_id, datos_anteriores)
select '20261011150000', 'echeqs', e.id, jsonb_build_object('origen_id', e.origen_id, 'movimiento_id', e.movimiento_id)
from public.echeqs e
where e.id in ('16df94ad-6300-46c3-84e2-6edd7cac69ad', '346b9a89-8863-4299-adf3-b139ef3352e9',
               'fff7184f-bdf1-4e17-a974-3fbeb238bd21', '4357d387-de1d-459c-9ff0-3c44d8ef0787')
  and not exists (select 1 from public.lz_respaldo_correcciones r where r.migracion = '20261011150000' and r.registro_id = e.id);

insert into public.lz_respaldo_correcciones (migracion, tabla, registro_id, datos_anteriores)
select '20261011150000', 'facturas', f.id,
       jsonb_build_object('factura_origen_id', f.factura_origen_id, 'credito_aplicado', f.credito_aplicado,
                          'saldo_a_favor_cliente', f.saldo_a_favor_cliente, 'nota_credito_modo', f.nota_credito_modo)
from public.facturas f
where f.id = 'c0283b57-d5ed-4f56-b66f-77df61239d54'
  and not exists (select 1 from public.lz_respaldo_correcciones r where r.migracion = '20261011150000' and r.registro_id = f.id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Correcciones de datos
-- ─────────────────────────────────────────────────────────────────────────────
update public.movimientos
set fecha = date '2026-09-30', conciliado = false
where id in ('5066f916-e5e1-44f3-befc-75d1cf7f9544', '815c15e7-32ae-4996-b9f2-7efc9496f4ac')
  and fecha = date '2026-11-20';

update public.movimientos
set fecha = date '2026-09-18', conciliado = false
where id = '741c621e-0e43-41bb-8f15-6b68d1014a69'
  and fecha = date '2026-10-16';

-- Cheque 00000131 (BARRAZA): cliente y cobro.
update public.echeqs
set origen_id = '08c1cb6c-ae3d-4a54-9ec0-9c2e52e919d9',
    movimiento_id = coalesce(movimiento_id, '741c621e-0e43-41bb-8f15-6b68d1014a69')
where id = '16df94ad-6300-46c3-84e2-6edd7cac69ad';

-- Cheques 00000074 y 00000176 (BARRAZA) y 3881 (DEL SOL): atados a su cobro.
update public.echeqs set movimiento_id = 'f16850a1-84f6-465c-9461-9d2ff1cc1677'
where id = '346b9a89-8863-4299-adf3-b139ef3352e9' and movimiento_id is null;
update public.echeqs set movimiento_id = '41efd2fb-c514-4c0a-87e8-bc4385150c06'
where id = 'fff7184f-bdf1-4e17-a974-3fbeb238bd21' and movimiento_id is null;
update public.echeqs set movimiento_id = '5066f916-e5e1-44f3-befc-75d1cf7f9544'
where id = '4357d387-de1d-459c-9ff0-3c44d8ef0787' and movimiento_id is null;

-- NC A 0015-00000005 (DEL SOL) → FA 0015-00000039 (ya anulada, con total_acreditado igual al total de la NC).
update public.facturas
set factura_origen_id = '893cf6b7-dcdc-4ca0-896e-255f5b922417',
    credito_aplicado = total,
    saldo_a_favor_cliente = 0
where id = 'c0283b57-d5ed-4f56-b66f-77df61239d54'
  and factura_origen_id is null
  and exists (
    select 1 from public.facturas o
    where o.id = '893cf6b7-dcdc-4ca0-896e-255f5b922417'
      and o.cliente_id = facturas.cliente_id
      and abs(o.total_acreditado - facturas.total) <= 0.01
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Los cobros nuevos nacen "pendientes de conciliar"
-- ─────────────────────────────────────────────────────────────────────────────
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

  perform 1
  from public.facturas f
  where f.id = p_factura_id
    and f.sociedad_id = p_sociedad_id
  for update;

  -- Pendiente de conciliar: "conciliado" es haberlo visto en el banco.
  v_result := public.registrar_cobro(
    p_factura_id := p_factura_id,
    p_lineas := p_lineas,
    p_fecha := p_fecha,
    p_sociedad_id := p_sociedad_id,
    p_created_by := auth.uid(),
    p_conciliado := false
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
        direccion, tipo_cheque, numero, banco_emisor, monto, moneda, fecha_pago, estado,
        origen_tipo, origen_id, origen_nombre, sociedad_id, user_id, observaciones
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

  -- La función histórica graba "conciliado = true" fijo: estos movimientos quedan pendientes de conciliar.
  update public.movimientos
  set conciliado = false
  where sociedad_id = p_sociedad_id
    and id in (select (jsonb_array_elements_text(coalesce(v_result->'inserted_ids', '[]'::jsonb)))::uuid);

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
        direccion, tipo_cheque, numero, banco_emisor, monto, moneda, fecha_pago, estado,
        origen_tipo, origen_id, origen_nombre, sociedad_id, user_id, observaciones
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) NC manual de venta contra varias facturas
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.nota_credito_venta_aplicaciones (
  id uuid primary key default gen_random_uuid(),
  nota_credito_id uuid not null references public.facturas(id) on delete restrict,
  factura_id uuid not null references public.facturas(id) on delete restrict,
  monto numeric(15,2) not null check (monto > 0),
  aplicado numeric(15,2) not null default 0 check (aplicado >= 0),
  sociedad_id uuid not null references public.sociedades(id),
  created_at timestamptz not null default now(),
  unique (nota_credito_id, factura_id)
);
create index if not exists nota_credito_venta_aplicaciones_factura_idx
  on public.nota_credito_venta_aplicaciones(factura_id);

alter table public.nota_credito_venta_aplicaciones enable row level security;
revoke all on public.nota_credito_venta_aplicaciones from anon, authenticated;
grant select on public.nota_credito_venta_aplicaciones to authenticated;
drop policy if exists nota_credito_venta_aplicaciones_read on public.nota_credito_venta_aplicaciones;
create policy nota_credito_venta_aplicaciones_read
  on public.nota_credito_venta_aplicaciones
  for select to authenticated
  using (exists (
    select 1 from public.user_sociedades us
    where us.user_id = auth.uid() and us.sociedad_id = nota_credito_venta_aplicaciones.sociedad_id
  ));

-- p_facturas: [{ "id": uuid, "monto": numeric }] — cuánto de la NC corresponde a cada factura (suma = total).
create or replace function public.crear_nota_credito_manual_venta_multiple(
  p_request_key uuid,
  p_sociedad_id uuid,
  p_facturas jsonb,
  p_tipo text,
  p_punto_venta integer,
  p_numero integer,
  p_fecha date,
  p_subtotal numeric,
  p_iva numeric,
  p_total numeric,
  p_items jsonb,
  p_cae text default null,
  p_cae_vencimiento date default null,
  p_observaciones text default null,
  p_confirmar boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_tipo text := upper(btrim(coalesce(p_tipo, '')));
  v_subtotal numeric := round(coalesce(p_subtotal, 0), 2);
  v_iva numeric := round(coalesce(p_iva, 0), 2);
  v_total numeric := round(coalesce(p_total, 0), 2);
  v_existente public.facturas%rowtype;
  v_primera public.facturas%rowtype;
  v_f public.facturas%rowtype;
  v_item jsonb;
  v_ordinal integer := 0;
  v_nc_id uuid;
  v_suma numeric := 0;
  v_cliente uuid;
  v_moneda text;
  v_monto numeric;
  v_cobrado numeric;
  v_saldo numeric;
  v_aplicado numeric;
  v_aplicado_total numeric := 0;
  v_saldo_favor numeric := 0;
  v_acreditado_nuevo numeric;
  v_estado_nuevo public.factura_status;
  v_avisos jsonb := '[]'::jsonb;
  v_detalle jsonb := '[]'::jsonb;
  v_descripcion text;
  v_cantidad numeric;
  v_precio numeric;
  v_item_iva numeric;
begin
  if v_user is null
    or not exists (select 1 from public.profiles where id = v_user and role::text in ('super_admin', 'admin', 'administrativo'))
    or not exists (select 1 from public.user_sociedades where user_id = v_user and sociedad_id = p_sociedad_id)
  then
    raise exception 'No tenés autorización para registrar notas de crédito en esta sociedad' using errcode = '42501';
  end if;

  if p_request_key is null or p_sociedad_id is null or p_fecha is null
    or p_numero is null or p_numero <= 0 or p_punto_venta is null or p_punto_venta < 0
    or p_facturas is null or jsonb_typeof(p_facturas) <> 'array' or jsonb_array_length(p_facturas) = 0
    or p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0
  then
    raise exception 'Faltan datos mínimos para registrar la nota de crédito' using errcode = '22023';
  end if;

  if v_tipo not in ('NCA', 'NCB') or v_subtotal < 0 or v_iva < 0 or v_total <= 0
    or abs(v_total - round(v_subtotal + v_iva, 2)) > 0.01
  then
    raise exception 'El tipo o los importes de la nota de crédito son inválidos' using errcode = '22023';
  end if;

  select coalesce(sum(round((x->>'monto')::numeric, 2)), 0) into v_suma from jsonb_array_elements(p_facturas) x;
  if abs(v_suma - v_total) > 0.02 then
    raise exception 'Lo asignado a las facturas (%) no coincide con el total de la NC (%)', v_suma, v_total using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('nc_manual_venta_multiple:' || p_sociedad_id::text || ':' || p_request_key::text, 0));

  select * into v_existente from public.facturas
  where sociedad_id = p_sociedad_id and nota_credito_request_key = p_request_key;
  if found then
    return jsonb_build_object('ok', true, 'factura_id', v_existente.id, 'replayed', true);
  end if;

  -- Bloqueo en orden estable y controles: mismo cliente, misma moneda, tipo coherente.
  for v_f in
    select f.* from public.facturas f
    where f.id in (select (x->>'id')::uuid from jsonb_array_elements(p_facturas) x)
      and f.sociedad_id = p_sociedad_id
    order by f.id
    for update
  loop
    if v_f.tipo::text like 'NC%' or v_f.tipo::text in ('FCEA', 'FCEB') then
      raise exception 'La factura %-% no admite una NC manual', v_f.punto_venta, v_f.numero using errcode = '22023';
    end if;
    if (v_tipo = 'NCA') <> (v_f.tipo::text = 'FA') then
      raise exception 'El tipo de la nota no corresponde al de la factura %-%', v_f.punto_venta, v_f.numero using errcode = '22023';
    end if;
    if v_cliente is null then v_cliente := v_f.cliente_id; v_moneda := v_f.moneda::text; end if;
    if v_f.cliente_id is distinct from v_cliente or v_f.moneda::text is distinct from v_moneda then
      raise exception 'Todas las facturas tienen que ser del mismo cliente y la misma moneda' using errcode = '22023';
    end if;
  end loop;

  if (select count(*) from public.facturas f
      where f.sociedad_id = p_sociedad_id
        and f.id in (select (x->>'id')::uuid from jsonb_array_elements(p_facturas) x))
     <> jsonb_array_length(p_facturas) then
    raise exception 'Alguna factura no existe en la sociedad seleccionada' using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    begin
      v_descripcion := btrim(coalesce(v_item->>'descripcion', ''));
      v_cantidad := (v_item->>'cantidad')::numeric;
      v_precio := (v_item->>'precio_unitario')::numeric;
      v_item_iva := coalesce((v_item->>'iva_porcentaje')::numeric, 21);
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'Un ítem de la nota tiene un número inválido' using errcode = '22023';
    end;
    if v_descripcion = '' or v_cantidad is null or v_cantidad <= 0 or v_precio is null or v_precio < 0
      or v_item_iva < 0 or v_item_iva > 100 then
      raise exception 'Cada ítem necesita descripción, cantidad y precio válidos' using errcode = '22023';
    end if;
  end loop;

  -- Saldo de cada factura y avisos (nunca bloqueo: se pide confirmación).
  for v_item in select value from jsonb_array_elements(p_facturas)
  loop
    select * into v_f from public.facturas where id = (v_item->>'id')::uuid;
    v_monto := round((v_item->>'monto')::numeric, 2);
    select coalesce(sum(m.monto), 0) into v_cobrado
    from public.movimientos m
    where m.factura_id = v_f.id and m.sociedad_id = p_sociedad_id and not coalesce(m.anulado, false);
    v_cobrado := v_cobrado + coalesce((
      select sum(a.monto) from public.cobro_aplicaciones a
      join public.movimientos m on m.id = a.movimiento_id
      where a.factura_id = v_f.id and m.sociedad_id = p_sociedad_id and not coalesce(m.anulado, false)), 0);
    v_saldo := greatest(0, round(v_f.total - coalesce(v_f.total_acreditado, 0) - v_cobrado, 2));
    if v_monto > v_saldo + 0.01 then
      v_avisos := v_avisos || to_jsonb(format(
        'La factura %s-%s tiene saldo %s (cobrado %s) y la NC le asigna %s: la diferencia queda como saldo a favor del cliente.',
        lpad(v_f.punto_venta::text, 4, '0'), lpad(v_f.numero::text, 8, '0'),
        to_char(v_saldo, 'FM999G999G999G990D00'), to_char(v_cobrado, 'FM999G999G999G990D00'),
        to_char(v_monto, 'FM999G999G999G990D00')));
    end if;
    v_detalle := v_detalle || jsonb_build_object('id', v_f.id, 'monto', v_monto, 'saldo', v_saldo, 'cobrado', v_cobrado);
  end loop;

  if jsonb_array_length(v_avisos) > 0 and not coalesce(p_confirmar, false) then
    return jsonb_build_object('ok', false, 'requires_confirmation', true, 'avisos', v_avisos, 'detalle', v_detalle);
  end if;

  select * into v_primera from public.facturas where id = (p_facturas->0->>'id')::uuid;

  insert into public.facturas (
    tipo, punto_venta, numero, cliente_id, fecha, cae, cae_vencimiento,
    subtotal, iva, total, moneda, tipo_cambio, estado, sociedad_id,
    factura_origen_id, observaciones, created_by,
    nota_credito_request_key, nota_credito_modo, credito_aplicado, saldo_a_favor_cliente
  ) values (
    v_tipo::public.comprobante_type, p_punto_venta, p_numero, v_cliente, p_fecha,
    nullif(btrim(coalesce(p_cae, '')), ''), p_cae_vencimiento,
    v_subtotal, v_iva, v_total, v_primera.moneda, v_primera.tipo_cambio,
    'emitida'::public.factura_status, p_sociedad_id,
    v_primera.id, nullif(btrim(coalesce(p_observaciones, '')), ''), v_user,
    p_request_key, 'amount', 0, 0
  ) returning id into v_nc_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    insert into public.factura_items (factura_id, descripcion, cantidad, precio_unitario, iva_porcentaje, orden)
    values (v_nc_id, btrim(v_item->>'descripcion'), (v_item->>'cantidad')::numeric,
            (v_item->>'precio_unitario')::numeric, coalesce((v_item->>'iva_porcentaje')::numeric, 21),
            coalesce((v_item->>'orden')::integer, v_ordinal));
    v_ordinal := v_ordinal + 1;
  end loop;

  -- Aplicación a cada factura y su estado (misma regla que la NC manual de una factura).
  for v_item in select value from jsonb_array_elements(v_detalle)
  loop
    select * into v_f from public.facturas where id = (v_item->>'id')::uuid;
    v_monto := (v_item->>'monto')::numeric;
    v_saldo := (v_item->>'saldo')::numeric;
    v_cobrado := (v_item->>'cobrado')::numeric;
    v_aplicado := least(v_monto, v_saldo);
    v_aplicado_total := v_aplicado_total + v_aplicado;
    v_saldo_favor := v_saldo_favor + greatest(0, v_monto - v_aplicado);
    v_acreditado_nuevo := round(coalesce(v_f.total_acreditado, 0) + v_aplicado, 2);

    v_estado_nuevo := case
      when v_acreditado_nuevo >= v_f.total - 0.01 and v_cobrado <= 0.005 then 'anulada'::public.factura_status
      when v_cobrado + v_acreditado_nuevo >= v_f.total - 0.01 then 'pagada'::public.factura_status
      when v_cobrado + v_acreditado_nuevo > 0.005 then 'parcial'::public.factura_status
      else v_f.estado
    end;

    update public.facturas
    set total_acreditado = v_acreditado_nuevo, estado = v_estado_nuevo
    where id = v_f.id;

    insert into public.nota_credito_venta_aplicaciones (nota_credito_id, factura_id, monto, aplicado, sociedad_id)
    values (v_nc_id, v_f.id, v_monto, v_aplicado, p_sociedad_id);
  end loop;

  update public.facturas
  set credito_aplicado = round(v_aplicado_total, 2), saldo_a_favor_cliente = round(v_saldo_favor, 2)
  where id = v_nc_id;

  return jsonb_build_object(
    'ok', true,
    'factura_id', v_nc_id,
    'credito_aplicado', round(v_aplicado_total, 2),
    'saldo_a_favor', round(v_saldo_favor, 2),
    'avisos', v_avisos,
    'replayed', false
  );
end;
$$;

revoke all on function public.crear_nota_credito_manual_venta_multiple(
  uuid, uuid, jsonb, text, integer, integer, date, numeric, numeric, numeric, jsonb, text, date, text, boolean
) from public, anon;
grant execute on function public.crear_nota_credito_manual_venta_multiple(
  uuid, uuid, jsonb, text, integer, integer, date, numeric, numeric, numeric, jsonb, text, date, text, boolean
) to authenticated;
comment on function public.crear_nota_credito_manual_venta_multiple(
  uuid, uuid, jsonb, text, integer, integer, date, numeric, numeric, numeric, jsonb, text, date, text, boolean
) is 'NC de venta hecha fuera del sistema (con su CAE) que cancela varias facturas del mismo cliente. Avisa, no bloquea.';

commit;
