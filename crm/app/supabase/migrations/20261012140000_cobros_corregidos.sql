-- Cobros corregidos: registrar_cobro y registrar_cobro_masivo (las de Manu, que usan las _seguro) — 12/10/2026, con OK de Augusto.
--
-- Qué arregla:
--   1) Se pueden cobrar facturas "vencida" (antes daba error).
--   2) Lo cobrado se calcula con la misma regla que "Anular cobro" (gestionar_cobro): sin cobros anulados y sin contar nada dos veces.
--      Antes, después de un cheque rebotado, la factura podía quedar "pagada" antes de tiempo.
--   3) Cobro masivo: la base calcula sola el saldo real de cada factura y reparte de la más vieja a la más nueva
--      (antes: en proporción, con el saldo que mandaba la pantalla).
--   4) Cobro masivo: cada medio de pago y cada retención queda atado a las facturas que pagó (cobro_aplicaciones).
--      Antes todo quedaba atado al primer medio: si rebotaba otro cheque, la factura seguía "pagada".
--   5) Pago de más: lo que sobra queda como SALDO A FAVOR del cliente en su cuenta corriente
--      (movimiento "ajuste" sin factura, ajuste_sentido = 'credito', atado al cobro que lo generó en cobro_origen_id).
--      Si después se anula o se borra ese cobro (por ejemplo, rebota el cheque), el saldo a favor se anula solo.
--   6) Moneda: la de las facturas. No se mezclan pesos y dólares en un mismo cobro.
--      Facturas en dólares: los medios y retenciones vienen en pesos con su "tipo_cambio"; los movimientos quedan en pesos (ARS)
--      y lo aplicado a cada factura, en dólares (antes los pesos se grababan como si fueran dólares).
--
-- Mismos nombres y mismos datos de entrada: registrar_cobro_seguro, registrar_cobro_masivo_seguro,
-- registrar_cobro_masivo_diferencia_cc y la pantalla siguen funcionando igual.
--
-- Aditiva: no borra ni cambia ningún dato existente. Agrega una columna (movimientos.cobro_origen_id),
-- dos funciones de ayuda y un disparador; reescribe las dos funciones de cobro.
-- Vuelta atrás: supabase/rollback/20261012140000_cobros_corregidos.sql (deja las funciones exactamente como estaban).
begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Saldo a favor atado al cobro que lo generó
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.movimientos
  add column if not exists cobro_origen_id uuid references public.movimientos(id) on delete set null;

comment on column public.movimientos.cobro_origen_id is
  'Saldo a favor por pago de más: cobro (medio o retención) que lo generó. Si ese cobro se anula o se borra, el saldo a favor se anula solo.';

create index if not exists movimientos_cobro_origen_id_idx
  on public.movimientos (cobro_origen_id)
  where cobro_origen_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Lo cobrado de una factura (misma regla que gestionar_cobro)
--    Cobros directos (sin aplicaciones, para no contarlos dos veces) + aplicaciones vigentes. Sin anulados.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.lz_cobrado_factura(p_factura_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce((
      select sum(m.monto)
      from public.movimientos m
      where m.factura_id = p_factura_id
        and not coalesce(m.anulado, false)
        and not exists (select 1 from public.cobro_aplicaciones ca where ca.movimiento_id = m.id)
    ), 0)
    + coalesce((
      select sum(ca.monto)
      from public.cobro_aplicaciones ca
      join public.movimientos m on m.id = ca.movimiento_id
      where ca.factura_id = p_factura_id
        and not coalesce(m.anulado, false)
    ), 0);
$$;

-- Estado de la factura después de un cobro (misma regla que gestionar_cobro; no toca las anuladas).
create or replace function public.lz_estado_factura_por_cobro(p_factura_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cobrado numeric;
  v_estado text;
begin
  v_cobrado := public.lz_cobrado_factura(p_factura_id);

  update public.facturas
  set estado = case
    when estado = 'anulada' then estado
    when v_cobrado + coalesce(total_acreditado, 0) >= total - 0.01 then 'pagada'::public.factura_status
    when v_cobrado + coalesce(total_acreditado, 0) > 0 then 'parcial'::public.factura_status
    else estado
  end
  where id = p_factura_id
  returning estado::text into v_estado;

  return v_estado;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Si se anula o se borra un cobro, se anula el saldo a favor que generó
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.lz_anular_a_favor_de_cobro()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if tg_op = 'DELETE' then
    v_id := old.id;
  else
    v_id := new.id;
  end if;

  update public.movimientos
  set anulado = true,
      monto_original = monto,
      monto = 0,
      anulado_at = now(),
      anulado_por = auth.uid(),
      conciliado = false,
      descripcion = '[ANULADO · se anuló el cobro que lo generó] ' || regexp_replace(descripcion, '^\[ANULADO[^\]]*\]\s*', '')
  where cobro_origen_id = v_id
    and not coalesce(anulado, false);

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists lz_anular_a_favor_de_cobro on public.movimientos;
create trigger lz_anular_a_favor_de_cobro
  after update of anulado on public.movimientos
  for each row
  when (new.anulado and not coalesce(old.anulado, false))
  execute function public.lz_anular_a_favor_de_cobro();

drop trigger if exists lz_anular_a_favor_de_cobro_borrado on public.movimientos;
create trigger lz_anular_a_favor_de_cobro_borrado
  before delete on public.movimientos
  for each row
  execute function public.lz_anular_a_favor_de_cobro();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Cobro de una factura
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.registrar_cobro(
  p_factura_id uuid,
  p_lineas jsonb,
  p_fecha date,
  p_sociedad_id uuid,
  p_created_by uuid,
  p_conciliado boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_factura record;
  v_linea jsonb;
  v_monto numeric;
  v_saldo numeric;
  v_total_lineas numeric := 0;
  v_inserted_ids uuid[] := '{}';
  v_lineas_ids uuid[] := '{}';
  v_lineas_montos numeric[] := '{}';
  v_new_id uuid;
  v_comprobante text;
  v_sobra numeric;
  v_parte numeric;
  v_a_favor numeric := 0;
  v_i int;
  v_estado text;
  v_cobrado numeric;
begin
  select id, total, total_acreditado, cliente_id, moneda, tipo, punto_venta, numero, estado, sociedad_id
  into v_factura
  from public.facturas
  where id = p_factura_id
  for update;

  if not found then
    raise exception 'Factura no encontrada';
  end if;
  if v_factura.sociedad_id is distinct from p_sociedad_id then
    raise exception 'La factura no pertenece a la sociedad activa';
  end if;
  if v_factura.estado::text not in ('emitida', 'parcial', 'vencida') then
    raise exception 'La factura no está en estado válido para cobro (estado: %)', v_factura.estado;
  end if;
  if jsonb_typeof(p_lineas) is distinct from 'array' or jsonb_array_length(p_lineas) = 0 then
    raise exception 'El cobro no tiene renglones';
  end if;

  -- Saldo real antes de este cobro.
  v_saldo := greatest(0, round(v_factura.total - coalesce(v_factura.total_acreditado, 0) - public.lz_cobrado_factura(p_factura_id), 2));
  v_comprobante := v_factura.tipo || ' ' || lpad(v_factura.punto_venta::text, 4, '0') || '-' || lpad(v_factura.numero::text, 8, '0');

  for v_linea in select value from jsonb_array_elements(p_lineas)
  loop
    v_monto := round((v_linea->>'monto')::numeric, 2);
    if v_monto is null or v_monto <= 0 then
      raise exception 'Cada renglón del cobro necesita un importe mayor a cero';
    end if;

    insert into public.movimientos (tipo, cliente_id, factura_id, descripcion, monto, moneda, fecha, conciliado, created_by, sociedad_id)
    values (
      (v_linea->>'tipo')::public.movimiento_tipo,
      v_factura.cliente_id,
      p_factura_id,
      coalesce(v_linea->>'descripcion', 'Cobro ' || v_comprobante),
      v_monto,
      coalesce(v_factura.moneda::text, 'ARS')::public.moneda_type,
      p_fecha,
      p_conciliado,
      p_created_by,
      p_sociedad_id
    )
    returning id into v_new_id;

    v_inserted_ids := v_inserted_ids || v_new_id;
    v_lineas_ids := v_lineas_ids || v_new_id;
    v_lineas_montos := v_lineas_montos || v_monto;
    v_total_lineas := v_total_lineas + v_monto;
  end loop;

  -- Pago de más: lo que sobra queda a favor del cliente, atado a los últimos renglones (si se anulan, se anula solo).
  v_sobra := round(v_total_lineas - v_saldo, 2);
  if v_sobra >= 0.01 then
    v_i := array_length(v_lineas_ids, 1);
    while v_sobra >= 0.01 and v_i >= 1 loop
      v_parte := least(v_sobra, v_lineas_montos[v_i]);
      insert into public.movimientos (
        tipo, cliente_id, factura_id, descripcion, monto, moneda, fecha, conciliado, created_by, sociedad_id, ajuste_sentido, cobro_origen_id
      ) values (
        'ajuste', v_factura.cliente_id, null,
        'Saldo a favor: pagó de más — Cobro ' || v_comprobante,
        v_parte, coalesce(v_factura.moneda::text, 'ARS')::public.moneda_type,
        p_fecha, false, p_created_by, p_sociedad_id, 'credito', v_lineas_ids[v_i]
      )
      returning id into v_new_id;
      v_inserted_ids := v_inserted_ids || v_new_id;
      v_a_favor := v_a_favor + v_parte;
      v_sobra := round(v_sobra - v_parte, 2);
      v_i := v_i - 1;
    end loop;
  end if;

  v_estado := public.lz_estado_factura_por_cobro(p_factura_id);
  v_cobrado := public.lz_cobrado_factura(p_factura_id);

  return jsonb_build_object(
    'success', true,
    'inserted_ids', to_jsonb(v_inserted_ids),
    'total_cobrado', v_cobrado,
    'pagada', v_estado = 'pagada',
    'a_favor', v_a_favor
  );
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) Cobro de varias facturas juntas
--    p_facturas: [{id, numero, saldo}] — "saldo" ya no se usa: la base calcula el saldo real.
--    p_medios / p_retenciones: [{tipo, monto, descripcion, tipo_cambio?}] — en dólares, montos en pesos + tipo_cambio.
--    Reparto: primero las retenciones y después los medios, en el orden recibido; cada uno llena las facturas
--    de la más vieja a la más nueva. Lo que no entra en ninguna factura queda a favor del cliente.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.registrar_cobro_masivo(
  p_cliente_id uuid,
  p_facturas jsonb,
  p_medios jsonb,
  p_retenciones jsonb,
  p_fecha date,
  p_sociedad_id uuid,
  p_created_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_retenciones jsonb := coalesce(p_retenciones, '[]'::jsonb);
  v_f record;
  v_pieza record;
  v_moneda text;
  v_moneda_mov text;
  v_es_usd boolean;
  v_tc numeric := 1;
  v_ids uuid[] := '{}';
  v_saldos numeric[] := '{}';
  v_aplicados numeric[] := '{}';
  v_etiquetas text[] := '{}';
  v_n int := 0;
  v_idx int;
  v_total_pesos numeric := 0;
  v_resto numeric;
  v_libre numeric;
  v_a numeric;
  v_monto numeric;
  v_new_id uuid;
  v_inserted_ids uuid[] := '{}';
  v_desc_facturas text;
  v_cobradas text[] := '{}';
  v_a_favor numeric := 0;
  v_facturas_cobradas int := 0;
begin
  if jsonb_typeof(p_facturas) is distinct from 'array' or jsonb_array_length(p_facturas) = 0 then
    raise exception 'El cobro no tiene facturas';
  end if;
  if jsonb_typeof(p_medios) is distinct from 'array' or jsonb_typeof(v_retenciones) is distinct from 'array'
    or jsonb_array_length(p_medios) + jsonb_array_length(v_retenciones) = 0 then
    raise exception 'El cobro no tiene medios de pago';
  end if;
  if (select count(distinct value->>'id') from jsonb_array_elements(p_facturas)) <> jsonb_array_length(p_facturas) then
    raise exception 'La misma factura está dos veces en el cobro';
  end if;

  -- Bloqueo de las facturas (siempre en el mismo orden, para no trabarse con otro cobro).
  perform 1
  from public.facturas f
  where f.id in (select (value->>'id')::uuid from jsonb_array_elements(p_facturas))
  order by f.id
  for update;

  -- Validación y saldo real, de la más vieja a la más nueva.
  for v_f in
    select x.item, f.id, f.total, f.total_acreditado, f.estado::text as estado, f.moneda::text as moneda,
           f.cliente_id, f.sociedad_id, f.tipo, f.punto_venta, f.numero
    from (select value as item, ordinality as ord from jsonb_array_elements(p_facturas) with ordinality) x
    left join public.facturas f on f.id = (x.item->>'id')::uuid
    order by f.fecha nulls last, f.punto_venta, f.numero, x.ord
  loop
    if v_f.id is null then
      raise exception 'Factura % no encontrada', coalesce(v_f.item->>'numero', v_f.item->>'id');
    end if;
    if v_f.sociedad_id is distinct from p_sociedad_id or v_f.cliente_id is distinct from p_cliente_id then
      raise exception 'La factura % es de otro cliente o de otra sociedad', coalesce(v_f.item->>'numero', v_f.numero::text);
    end if;
    if v_f.estado not in ('emitida', 'parcial', 'vencida') then
      raise exception 'Factura % no está en estado válido para cobro (estado: %)', coalesce(v_f.item->>'numero', v_f.numero::text), v_f.estado;
    end if;
    if v_moneda is null then
      v_moneda := coalesce(v_f.moneda, 'ARS');
    elsif v_moneda <> coalesce(v_f.moneda, 'ARS') then
      raise exception 'No se pueden cobrar juntas facturas en pesos y en dólares: hacé un cobro por cada moneda';
    end if;

    v_n := v_n + 1;
    v_ids := v_ids || v_f.id;
    v_saldos := v_saldos || greatest(0, round(v_f.total - coalesce(v_f.total_acreditado, 0) - public.lz_cobrado_factura(v_f.id), 2));
    v_aplicados := v_aplicados || 0::numeric;
    v_etiquetas := v_etiquetas || coalesce(nullif(trim(v_f.item->>'numero'), ''),
      v_f.tipo || ' ' || lpad(v_f.punto_venta::text, 4, '0') || '-' || lpad(v_f.numero::text, 8, '0'));
  end loop;

  -- Facturas en dólares: el cobro viene en pesos con su tipo de cambio.
  v_es_usd := v_moneda = 'USD';
  if v_es_usd then
    select (value->>'tipo_cambio')::numeric into v_tc
    from jsonb_array_elements(p_medios || v_retenciones)
    where nullif(value->>'tipo_cambio', '') is not null
    limit 1;
    if v_tc is null or v_tc <= 0 then
      raise exception 'Falta el tipo de cambio para cobrar facturas en dólares';
    end if;
    v_moneda_mov := 'ARS';
  else
    v_moneda_mov := v_moneda;
  end if;

  -- Validación de importes y total cobrado.
  for v_pieza in select value as item from jsonb_array_elements(v_retenciones || p_medios)
  loop
    v_monto := round((v_pieza.item->>'monto')::numeric, 2);
    if v_monto is null or v_monto <= 0 then
      raise exception 'Cada medio de pago y retención necesita un importe mayor a cero';
    end if;
    v_total_pesos := v_total_pesos + v_monto;
  end loop;

  -- Qué facturas reciben algo (para la descripción): de la más vieja a la más nueva.
  v_resto := v_total_pesos / v_tc;
  for v_idx in 1..v_n loop
    exit when v_resto < 0.005;
    if v_saldos[v_idx] > 0.005 then
      v_cobradas := v_cobradas || v_etiquetas[v_idx];
      v_resto := v_resto - least(v_resto, v_saldos[v_idx]);
    end if;
  end loop;
  if array_length(v_cobradas, 1) is null then
    v_cobradas := v_etiquetas;
  end if;
  v_desc_facturas := array_to_string(v_cobradas, ', ');

  -- Un movimiento por retención y por medio, cada uno aplicado a las facturas que paga.
  v_idx := 1;
  for v_pieza in
    select item, es_retencion
    from (
      select value as item, true as es_retencion, 1 as grupo, ordinality as ord from jsonb_array_elements(v_retenciones) with ordinality
      union all
      select value, false, 2, ordinality from jsonb_array_elements(p_medios) with ordinality
    ) piezas
    order by grupo, ord
  loop
    v_monto := round((v_pieza.item->>'monto')::numeric, 2);

    insert into public.movimientos (tipo, cliente_id, factura_id, descripcion, monto, moneda, fecha, conciliado, created_by, sociedad_id)
    values (
      (v_pieza.item->>'tipo')::public.movimiento_tipo,
      p_cliente_id,
      null,
      coalesce(v_pieza.item->>'descripcion', case when v_pieza.es_retencion then 'Retención' else 'Cobro' end) || ' — Facturas: ' || v_desc_facturas,
      v_monto,
      v_moneda_mov::public.moneda_type,
      p_fecha,
      false,
      p_created_by,
      p_sociedad_id
    )
    returning id into v_new_id;
    v_inserted_ids := v_inserted_ids || v_new_id;

    -- En la moneda de las facturas.
    v_resto := v_monto / v_tc;
    while v_resto >= 0.005 and v_idx <= v_n loop
      v_libre := v_saldos[v_idx] - v_aplicados[v_idx];
      if v_libre < 0.005 then
        v_idx := v_idx + 1;
        continue;
      end if;
      v_a := least(v_resto, v_libre);
      if round(v_a, 2) > 0 then
        insert into public.cobro_aplicaciones (movimiento_id, factura_id, monto)
        values (v_new_id, v_ids[v_idx], round(v_a, 2));
      end if;
      v_aplicados[v_idx] := v_aplicados[v_idx] + v_a;
      v_resto := v_resto - v_a;
    end loop;

    -- Lo que no entró en ninguna factura: saldo a favor del cliente (en la moneda de las facturas).
    if round(v_resto, 2) >= 0.01 then
      insert into public.movimientos (
        tipo, cliente_id, factura_id, descripcion, monto, moneda, fecha, conciliado, created_by, sociedad_id, ajuste_sentido, cobro_origen_id
      ) values (
        'ajuste', p_cliente_id, null,
        'Saldo a favor: pagó de más — Facturas: ' || v_desc_facturas,
        round(v_resto, 2), v_moneda::public.moneda_type,
        p_fecha, false, p_created_by, p_sociedad_id, 'credito', v_new_id
      )
      returning id into v_new_id;
      v_inserted_ids := v_inserted_ids || v_new_id;
      v_a_favor := v_a_favor + round(v_resto, 2);
    end if;
  end loop;

  -- Estado de las facturas que recibieron algo.
  for v_idx in 1..v_n loop
    if v_aplicados[v_idx] > 0 then
      perform public.lz_estado_factura_por_cobro(v_ids[v_idx]);
      v_facturas_cobradas := v_facturas_cobradas + 1;
    end if;
  end loop;

  perform public.recalcular_saldo_for_cliente(p_cliente_id);

  return jsonb_build_object(
    'success', true,
    'inserted_ids', to_jsonb(v_inserted_ids),
    'movimientos_count', array_length(v_inserted_ids, 1),
    'facturas_count', v_facturas_cobradas,
    'total_cobrado', v_total_pesos,
    'a_favor', v_a_favor,
    'moneda', v_moneda
  );
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) Solo se usan a través de las _seguro (que controlan permisos y sociedad)
-- ─────────────────────────────────────────────────────────────────────────────
revoke execute on function public.registrar_cobro(uuid, jsonb, date, uuid, uuid, boolean) from public, anon, authenticated;
revoke execute on function public.registrar_cobro_masivo(uuid, jsonb, jsonb, jsonb, date, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.lz_cobrado_factura(uuid) from public, anon, authenticated;
revoke execute on function public.lz_estado_factura_por_cobro(uuid) from public, anon, authenticated;
revoke execute on function public.lz_anular_a_favor_de_cobro() from public, anon, authenticated;

commit;
