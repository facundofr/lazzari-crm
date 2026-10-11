-- Correcciones de ventas (DIAGNOSTICO-FINANCIERO A8 y A9).
--
-- 1) crear_nota_credito_manual_venta: la NC manual de venta (sin ARCA) se graba
--    en una sola transacción (NC + renglones + factura origen + presupuesto),
--    idempotente por request_key. Si la NC supera el saldo pendiente de la
--    factura NO se bloquea: devuelve un aviso y espera p_confirmar = true.
--    La factura solo queda "anulada" si la NC la cubre entera y no tenía cobros.
-- 2) delete_manual_invoice: además del rol, exige pertenecer a la sociedad de
--    la factura.
--
-- Cambios aditivos e idempotentes: no se borran datos ni columnas.
-- Vuelta atrás: supabase/rollback/20261011110000_ventas_correcciones.sql
begin;

-- Las columnas ya existen desde 20261008120000_notas_credito_venta_atomicas.sql;
-- se repiten con "if not exists" por si esa migración no se hubiera corrido.
alter table public.facturas
  add column if not exists factura_origen_id uuid references public.facturas(id) on delete restrict,
  add column if not exists total_acreditado numeric(15,2) not null default 0,
  add column if not exists nota_credito_request_key uuid,
  add column if not exists nota_credito_modo text,
  add column if not exists credito_aplicado numeric(15,2) not null default 0,
  add column if not exists saldo_a_favor_cliente numeric(15,2) not null default 0;

create unique index if not exists facturas_nc_request_key_uidx
  on public.facturas(sociedad_id, nota_credito_request_key)
  where nota_credito_request_key is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) NC manual de venta, atómica e idempotente
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.crear_nota_credito_manual_venta(
  p_request_key uuid,
  p_sociedad_id uuid,
  p_factura_origen_id uuid,
  p_tipo text,
  p_punto_venta integer,
  p_numero integer,
  p_fecha date,
  p_subtotal numeric,
  p_iva numeric,
  p_total numeric,
  p_items jsonb,
  p_modo text default 'items',
  p_observaciones text default null,
  p_confirmar boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_origen public.facturas%rowtype;
  v_existente public.facturas%rowtype;
  v_nc_id uuid;
  v_item jsonb;
  v_ordinal integer := 0;
  v_tipo text := upper(btrim(coalesce(p_tipo, '')));
  v_modo text := lower(btrim(coalesce(p_modo, 'items')));
  v_subtotal numeric := round(coalesce(p_subtotal, 0), 2);
  v_iva numeric := round(coalesce(p_iva, 0), 2);
  v_total numeric := round(coalesce(p_total, 0), 2);
  v_cobrado numeric := 0;
  v_ncs_previas numeric := 0;
  v_aplicaciones numeric := 0;
  v_saldo_antes numeric;
  v_aplicado numeric;
  v_saldo_favor numeric;
  v_acreditado_nuevo numeric;
  v_cubre_total boolean;
  v_estado_nuevo public.factura_status;
  v_aviso text := null;
  v_descripcion text;
  v_cantidad numeric;
  v_precio numeric;
  v_item_iva numeric;
begin
  -- Rol Y sociedad (las dos cosas).
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
    raise exception 'No tenés autorización para registrar notas de crédito en esta sociedad'
      using errcode = '42501';
  end if;

  if p_request_key is null or p_sociedad_id is null or p_factura_origen_id is null
    or p_fecha is null or p_numero is null or p_numero <= 0
    or p_punto_venta is null or p_punto_venta < 0
    or p_items is null or jsonb_typeof(p_items) <> 'array'
    or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 500
  then
    raise exception 'Faltan datos mínimos para registrar la nota de crédito'
      using errcode = '22023';
  end if;

  if v_tipo not in ('NCA', 'NCB')
    or v_modo not in ('total', 'items', 'amount')
    or v_subtotal < 0 or v_iva < 0 or v_total <= 0
    or abs(v_total - round(v_subtotal + v_iva, 2)) > 0.01
  then
    raise exception 'El tipo o los importes de la nota de crédito son inválidos'
      using errcode = '22023';
  end if;

  -- Serializa reintentos y NC simultáneas sobre la misma factura.
  perform pg_advisory_xact_lock(hashtextextended(
    'nc_manual_venta:' || p_sociedad_id::text || ':' || p_factura_origen_id::text, 0));

  -- Idempotencia: la misma clave devuelve la NC ya grabada.
  select * into v_existente
  from public.facturas
  where sociedad_id = p_sociedad_id and nota_credito_request_key = p_request_key;
  if found then
    if v_existente.factura_origen_id is distinct from p_factura_origen_id
      or v_existente.tipo::text is distinct from v_tipo
      or v_existente.numero is distinct from p_numero
      or v_existente.total is distinct from v_total
      or coalesce(v_existente.created_by, v_user) is distinct from v_user
    then
      raise exception 'La solicitud ya existe con otros datos' using errcode = '22023';
    end if;
    return jsonb_build_object(
      'ok', true,
      'factura_id', v_existente.id,
      'factura_origen_id', v_existente.factura_origen_id,
      'credito_aplicado', v_existente.credito_aplicado,
      'saldo_a_favor', v_existente.saldo_a_favor_cliente,
      'replayed', true
    );
  end if;

  select * into v_origen
  from public.facturas
  where id = p_factura_origen_id and sociedad_id = p_sociedad_id
  for update;
  if not found then
    raise exception 'No se encontró la factura original en la sociedad seleccionada'
      using errcode = '22023';
  end if;
  if v_origen.tipo::text like 'NC%' or v_origen.tipo::text in ('FCEA', 'FCEB') then
    raise exception 'Las FCE y las notas de crédito no admiten una NC manual'
      using errcode = '22023';
  end if;
  if (v_tipo = 'NCA') <> (v_origen.tipo::text = 'FA') then
    raise exception 'El tipo de la nota no corresponde al de la factura original'
      using errcode = '22023';
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
    if v_descripcion = '' or v_cantidad is null or v_cantidad <= 0
      or v_precio is null or v_precio < 0 or v_item_iva < 0 or v_item_iva > 100
    then
      raise exception 'Cada ítem necesita descripción, cantidad y precio válidos'
        using errcode = '22023';
    end if;
  end loop;

  -- Saldo pendiente = total − NC previas (total_acreditado) − cobrado.
  select coalesce(sum(m.monto), 0) into v_cobrado
  from public.movimientos m
  where m.factura_id = v_origen.id
    and m.sociedad_id = p_sociedad_id
    and not coalesce(m.anulado, false);
  if to_regclass('public.cobro_aplicaciones') is not null then
    execute 'select coalesce(sum(a.monto), 0)
               from public.cobro_aplicaciones a
               join public.movimientos m on m.id = a.movimiento_id
              where a.factura_id = $1 and m.sociedad_id = $2
                and not coalesce(m.anulado, false)'
      into v_aplicaciones using v_origen.id, p_sociedad_id;
    v_cobrado := v_cobrado + coalesce(v_aplicaciones, 0);
  end if;
  v_ncs_previas := coalesce(v_origen.total_acreditado, 0);

  v_saldo_antes := greatest(0, round(v_origen.total - v_ncs_previas - v_cobrado, 2));

  -- Aviso (nunca bloqueo): si supera el saldo, se pide confirmación.
  if v_total > v_saldo_antes + 0.01 then
    v_aviso := format(
      'La NC (%s) supera el saldo pendiente de la factura (%s): total %s, cobrado %s, NC previas %s. La diferencia (%s) queda como saldo a favor del cliente.',
      to_char(v_total, 'FM999G999G999G990D00'),
      to_char(v_saldo_antes, 'FM999G999G999G990D00'),
      to_char(v_origen.total, 'FM999G999G999G990D00'),
      to_char(v_cobrado, 'FM999G999G999G990D00'),
      to_char(v_ncs_previas, 'FM999G999G999G990D00'),
      to_char(round(v_total - v_saldo_antes, 2), 'FM999G999G999G990D00'));
    if not coalesce(p_confirmar, false) then
      return jsonb_build_object(
        'ok', false,
        'requires_confirmation', true,
        'warning', v_aviso,
        'saldo_pendiente', v_saldo_antes,
        'cobrado', v_cobrado,
        'ncs_previas', v_ncs_previas
      );
    end if;
  end if;

  v_aplicado := least(v_total, v_saldo_antes);
  v_saldo_favor := greatest(0, round(v_total - v_aplicado, 2));
  v_acreditado_nuevo := round(v_ncs_previas + v_aplicado, 2);
  -- "Cubre el total": entre todas las NC llegan al total de la factura.
  v_cubre_total := round(v_ncs_previas + v_total, 2) >= v_origen.total - 0.01;

  insert into public.facturas (
    tipo, punto_venta, numero, cliente_id, fecha, cae, cae_vencimiento,
    subtotal, iva, total, moneda, tipo_cambio, estado, sociedad_id,
    factura_origen_id, observaciones, created_by,
    nota_credito_request_key, nota_credito_modo, credito_aplicado, saldo_a_favor_cliente
  ) values (
    v_tipo::public.comprobante_type, p_punto_venta, p_numero, v_origen.cliente_id,
    p_fecha, null, null,
    v_subtotal, v_iva, v_total, v_origen.moneda, v_origen.tipo_cambio,
    'emitida'::public.factura_status, p_sociedad_id,
    v_origen.id, nullif(btrim(coalesce(p_observaciones, '')), ''), v_user,
    p_request_key, v_modo, v_aplicado, v_saldo_favor
  ) returning id into v_nc_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    insert into public.factura_items (
      factura_id, descripcion, cantidad, precio_unitario, iva_porcentaje, orden
    ) values (
      v_nc_id, btrim(v_item->>'descripcion'), (v_item->>'cantidad')::numeric,
      (v_item->>'precio_unitario')::numeric,
      coalesce((v_item->>'iva_porcentaje')::numeric, 21),
      coalesce((v_item->>'orden')::integer, v_ordinal)
    );
    v_ordinal := v_ordinal + 1;
  end loop;

  -- Estado coherente de la factura origen:
  --   anulada  → la NC la cubre entera y no tenía cobros;
  --   pagada   → cobrado + acreditado alcanzan el total;
  --   parcial  → hay algo cobrado o acreditado;
  --   si no    → queda como estaba.
  v_estado_nuevo := case
    when v_cubre_total and v_cobrado <= 0.005 then 'anulada'::public.factura_status
    when v_cobrado + v_acreditado_nuevo >= v_origen.total - 0.01 then 'pagada'::public.factura_status
    when v_cobrado + v_acreditado_nuevo > 0.005 then 'parcial'::public.factura_status
    else v_origen.estado
  end;

  update public.facturas
  set total_acreditado = v_acreditado_nuevo,
      estado = v_estado_nuevo
  where id = v_origen.id and sociedad_id = p_sociedad_id;

  -- Si la NC deja la factura sin efecto, el presupuesto se puede volver a facturar.
  if v_cubre_total and v_origen.presupuesto_id is not null then
    update public.presupuestos
    set estado = 'facturar'
    where id = v_origen.presupuesto_id and sociedad_id = p_sociedad_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'factura_id', v_nc_id,
    'factura_origen_id', v_origen.id,
    'credito_aplicado', v_aplicado,
    'saldo_a_favor', v_saldo_favor,
    'saldo_restante', greatest(0, round(v_saldo_antes - v_aplicado, 2)),
    'estado_factura', v_estado_nuevo,
    'warning', v_aviso,
    'replayed', false
  );
end;
$$;

revoke all on function public.crear_nota_credito_manual_venta(
  uuid, uuid, uuid, text, integer, integer, date, numeric, numeric, numeric, jsonb, text, text, boolean
) from public, anon;
grant execute on function public.crear_nota_credito_manual_venta(
  uuid, uuid, uuid, text, integer, integer, date, numeric, numeric, numeric, jsonb, text, text, boolean
) to authenticated;

comment on function public.crear_nota_credito_manual_venta(
  uuid, uuid, uuid, text, integer, integer, date, numeric, numeric, numeric, jsonb, text, text, boolean
) is 'NC manual de venta (sin ARCA) atómica e idempotente; avisa si supera el saldo y no anula facturas con cobros.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) delete_manual_invoice: rol Y pertenencia a la sociedad de la factura
--    (mismo cuerpo que 20260831123000 más el chequeo de sociedad).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.delete_manual_invoice(p_factura_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_factura public.facturas%rowtype;
  v_role public.user_role;
begin
  v_role := public.get_my_role();
  if v_role is null or v_role not in (
    'super_admin'::public.user_role,
    'admin'::public.user_role,
    'administrativo'::public.user_role
  ) then
    raise exception 'No tenés permiso para eliminar facturas manuales';
  end if;

  select * into v_factura
  from public.facturas
  where id = p_factura_id
  for update;

  if not found then
    raise exception 'La factura no existe';
  end if;

  if not exists (
    select 1 from public.user_sociedades us
    where us.user_id = auth.uid()
      and us.sociedad_id = v_factura.sociedad_id
  ) then
    raise exception 'No tenés acceso a la sociedad de esta factura' using errcode = '42501';
  end if;

  if v_factura.cae is not null then
    raise exception 'Una factura autorizada por ARCA no se puede eliminar';
  end if;

  if v_factura.estado::text <> 'anulada' then
    raise exception 'Primero tenés que anular la factura manual';
  end if;

  if exists (select 1 from public.movimientos where factura_id = p_factura_id) then
    raise exception 'La factura tiene movimientos asociados y no se puede eliminar';
  end if;

  if exists (select 1 from public.remitos where factura_id = p_factura_id) then
    raise exception 'La factura tiene remitos asociados y no se puede eliminar';
  end if;

  if exists (select 1 from public.facturas where factura_origen_id = p_factura_id) then
    raise exception 'La factura tiene notas de crédito asociadas y no se puede eliminar';
  end if;

  delete from public.factura_items where factura_id = p_factura_id;
  delete from public.facturas where id = p_factura_id;
end;
$$;

revoke all on function public.delete_manual_invoice(uuid) from public;
grant execute on function public.delete_manual_invoice(uuid) to authenticated;

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- CONSULTAS DE CONTROL (solo lectura). Copiar de a una al SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- A) Facturas "anuladas" por una NC que tenían cobros (la plata quedó colgada):
-- select f.id, f.sociedad_id, f.tipo, f.punto_venta, f.numero, f.fecha, f.total, f.total_acreditado,
--        (select coalesce(sum(m.monto), 0) from public.movimientos m
--          where m.factura_id = f.id and not coalesce(m.anulado, false)) as cobrado
-- from public.facturas f
-- where f.estado = 'anulada'
--   and exists (select 1 from public.facturas nc where nc.factura_origen_id = f.id)
--   and exists (select 1 from public.movimientos m where m.factura_id = f.id and not coalesce(m.anulado, false))
-- order by f.fecha desc;
--
-- B) NC sin renglones (quedaron a mitad de camino con el circuito viejo de 3 pasos):
-- select nc.id, nc.sociedad_id, nc.tipo, nc.punto_venta, nc.numero, nc.fecha, nc.total, nc.factura_origen_id
-- from public.facturas nc
-- where nc.tipo::text like 'NC%'
--   and not exists (select 1 from public.factura_items i where i.factura_id = nc.id)
-- order by nc.fecha desc;
--
-- C) NC manuales posiblemente duplicadas (mismo origen, tipo, número y total):
-- select factura_origen_id, tipo, punto_venta, numero, total, count(*) as veces, array_agg(id) as ids
-- from public.facturas
-- where tipo::text like 'NC%' and cae is null and factura_origen_id is not null
-- group by factura_origen_id, tipo, punto_venta, numero, total
-- having count(*) > 1;
--
-- D) Facturas con NC por más que el total (total_acreditado > total):
-- select id, sociedad_id, tipo, punto_venta, numero, total, total_acreditado, estado
-- from public.facturas
-- where tipo::text not like 'NC%' and coalesce(total_acreditado, 0) > total + 0.01;
--
-- E) Facturas B emitidas con la facturación masiva desde presupuestos electrónicos
--    (A1: posible emisión sin IVA). Revisar las que tengan iva = 0 o total ≈ neto del PR:
-- select f.id, f.sociedad_id, f.tipo, f.punto_venta, f.numero, f.fecha, f.subtotal, f.iva, f.total,
--        p.numero as presupuesto, p.subtotal as pr_neto, p.total as pr_total
-- from public.facturas f
-- join public.presupuestos p on p.id = f.presupuesto_id
-- where f.tipo in ('FB', 'FCEB')
--   and coalesce(p.modalidad_emision, '') <> 'manual'
--   and abs(f.total - p.subtotal) < 0.05 and p.total > p.subtotal + 0.05
-- order by f.fecha desc;
--
-- F) Saldo real por cliente (para comparar con la columna vieja saldo_cuenta_corriente):
-- with cobrado as (
--   select m.factura_id, sum(m.monto) as monto
--   from public.movimientos m
--   where m.factura_id is not null and not coalesce(m.anulado, false)
--   group by m.factura_id
-- )
-- select c.id, c.razon_social, c.saldo_cuenta_corriente as columna_vieja, f.moneda,
--        sum(greatest(0, f.total - coalesce(f.total_acreditado, 0) - coalesce(cb.monto, 0))) as saldo_real
-- from public.clientes c
-- join public.facturas f on f.cliente_id = c.id and f.estado <> 'anulada' and f.tipo::text not like 'NC%'
-- left join cobrado cb on cb.factura_id = f.id
-- group by c.id, c.razon_social, c.saldo_cuenta_corriente, f.moneda
-- order by saldo_real desc;
