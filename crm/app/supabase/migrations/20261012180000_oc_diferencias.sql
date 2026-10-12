-- OC con diferencia entre lo pedido y lo facturado — 12/10/2026, con OK de Augusto ("dale 1 a 5").
--
-- Qué agrega:
--   1) diagnostico_diferencia_oc: números de la OC contra sus facturas (para el cartel amarillo del detalle).
--   2) ajustar_oc_a_factura: cuando la factura vino más barata (descuento) o con otro IVA, baja los precios de la OC en proporción
--      a la factura, pone el IVA de la factura y actualiza el COSTO en el PR (misma búsqueda de renglón y misma cuenta de margen
--      que la conciliación de compras: el precio de venta no cambia). Guarda todo lo anterior en lz_oc_ajustes.
--   3) deshacer_ajuste_oc: vuelve la OC y el PR a como estaban antes del ajuste.
--   4) Al cerrar o reabrir el saldo de una OC, el pago/facturación de la OC se recalcula solo (queda "pagada" si lo facturado ya se pagó)
--      y, si la OC viene de un PR, le llega un aviso al vendedor de ese PR.
-- Nada traba: son acciones que elige el usuario y se pueden deshacer.
--
-- Aditiva: no borra datos. Agrega 1 tabla, 5 funciones y 1 disparador.
-- Vuelta atrás: supabase/rollback/20261012180000_oc_diferencias.sql
begin;

create table if not exists public.lz_oc_ajustes (
  id uuid primary key default gen_random_uuid(),
  sociedad_id uuid not null,
  oc_id uuid not null references public.ordenes_compra(id) on delete cascade,
  oc_item_id uuid not null references public.orden_compra_items(id) on delete cascade,
  precio_anterior numeric not null,
  precio_nuevo numeric not null,
  iva_anterior numeric,
  iva_nuevo numeric,
  pr_item_id uuid references public.presupuesto_items(id) on delete set null,
  pr_costo_anterior numeric,
  pr_costo_moneda_anterior text,
  pr_markup_anterior numeric,
  deshecho boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists lz_oc_ajustes_oc_idx on public.lz_oc_ajustes (oc_id);
alter table public.lz_oc_ajustes enable row level security;
drop policy if exists lz_oc_ajustes_select on public.lz_oc_ajustes;
create policy lz_oc_ajustes_select on public.lz_oc_ajustes for select to authenticated using (true);

-- 1) Diagnóstico ---------------------------------------------------------------------------------------
create or replace function public.diagnostico_diferencia_oc(p_sociedad_id uuid, p_oc_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v jsonb;
begin
  if not public.lz_es_de_sociedad(p_sociedad_id) then
    raise exception 'No tenés acceso a esta sociedad' using errcode = '42501';
  end if;

  with oc as (
    select o.id, o.moneda::text as moneda, o.total, o.saldo_cerrado,
           (select coalesce(sum(i.cantidad * i.precio_unitario), 0) from orden_compra_items i where i.orden_id = o.id) as neto,
           (select coalesce(sum(i.cantidad), 0) from orden_compra_items i where i.orden_id = o.id) as cant_pedida,
           (select coalesce(sum(i.cantidad_recibida), 0) from orden_compra_items i where i.orden_id = o.id) as cant_recibida
    from ordenes_compra o
    where o.id = p_oc_id and o.sociedad_id = p_sociedad_id
  ), fcs as (
    select distinct f.id, f.subtotal, f.iva, f.total, f.estado, f.moneda::text as moneda,
           exists (select 1 from factura_compra_ocs l2 where l2.factura_compra_id = f.id and l2.orden_compra_id <> p_oc_id) as compartida
    from facturas_compra f
    where f.estado <> 'anulada'
      and coalesce(f.tipo_comprobante, '') !~* '^NC'
      and (f.orden_compra_id = p_oc_id
           or exists (select 1 from factura_compra_ocs l where l.factura_compra_id = f.id and l.orden_compra_id = p_oc_id))
  )
  select jsonb_build_object(
    'oc_neto', round(oc.neto, 2),
    'oc_total', oc.total,
    'moneda', oc.moneda,
    'saldo_cerrado', coalesce(oc.saldo_cerrado, false),
    'cant_pedida', oc.cant_pedida,
    'cant_recibida', oc.cant_recibida,
    'cant_facturada', (select sum(a.cantidad) from factura_compra_asignaciones a
                       join facturas_compra fa on fa.id = a.factura_compra_id
                       where a.orden_compra_id = p_oc_id and fa.estado <> 'anulada'),
    'n_facturas', (select count(*) from fcs),
    'fc_neto', (select coalesce(sum(subtotal), 0) from fcs),
    'fc_iva', (select coalesce(sum(iva), 0) from fcs),
    'fc_total', (select coalesce(sum(total), 0) from fcs),
    'todas_pagadas', (select count(*) > 0 and bool_and(estado = 'pagada') from fcs),
    'compartida', (select coalesce(bool_or(compartida), false) from fcs),
    'otra_moneda', (select coalesce(bool_or(coalesce(moneda, 'ARS') <> coalesce(oc.moneda, 'ARS')), false) from fcs),
    'ajuste_activo', exists (select 1 from lz_oc_ajustes a where a.oc_id = p_oc_id and not a.deshecho)
  )
  into v
  from oc;

  return v;
end;
$$;

-- 2) Ajustar la OC a la factura (y el costo del PR) ------------------------------------------------------
create or replace function public.ajustar_oc_a_factura(p_sociedad_id uuid, p_oc_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_oc record;
  v_d jsonb;
  v_factor numeric;
  v_rate numeric;
  v_iva_nuevo numeric;
  v_manual boolean;
  v_pr_ids text;
  v_it record;
  v_nuevo numeric;
  v_pi record;
  v_tc numeric;
  v_conv numeric;
  v_venta numeric;
  v_markup numeric;
  v_ajustados integer := 0;
  v_pr_count integer := 0;
  v_sin_pr text[] := '{}';
  v_hist_pr jsonb := '{}'::jsonb;
  v_k text;
  v_ajuste_id uuid;
begin
  if not public.lz_tiene_rol(array['super_admin','admin','administrativo','vendedor'])
     or not public.lz_es_de_sociedad(p_sociedad_id) then
    raise exception 'No tenés permiso para modificar compras de esta sociedad' using errcode = '42501';
  end if;

  select o.id, o.numero, o.moneda::text as moneda, o.presupuesto_origen_id, o.observaciones, o.estado,
         coalesce(pr.modalidad_emision = 'manual', false) as manual
  into v_oc
  from ordenes_compra o
  left join presupuestos pr on pr.id = o.presupuesto_origen_id
  where o.id = p_oc_id and o.sociedad_id = p_sociedad_id
  for update of o;
  if not found then
    raise exception 'No se encontró la OC' using errcode = 'P0002';
  end if;
  if v_oc.estado = 'cancelada' then
    raise exception 'La OC está cancelada';
  end if;
  if exists (select 1 from lz_oc_ajustes where oc_id = p_oc_id and not deshecho) then
    raise exception 'Esta OC ya tiene un ajuste. Deshacelo antes de ajustar de nuevo.';
  end if;

  v_d := public.diagnostico_diferencia_oc(p_sociedad_id, p_oc_id);
  if (v_d->>'n_facturas')::int = 0 then
    raise exception 'La OC no tiene facturas cargadas';
  end if;
  if (v_d->>'compartida')::boolean then
    raise exception 'La factura está repartida entre varias OC: el ajuste se hace desde la conciliación de la factura';
  end if;
  if (v_d->>'otra_moneda')::boolean then
    raise exception 'La factura está en otra moneda que la OC';
  end if;
  if (v_d->>'oc_neto')::numeric <= 0 or (v_d->>'fc_neto')::numeric <= 0 then
    raise exception 'No se puede calcular el ajuste (importes en cero)';
  end if;

  v_factor := (v_d->>'fc_neto')::numeric / (v_d->>'oc_neto')::numeric;
  v_rate := (v_d->>'fc_iva')::numeric / (v_d->>'fc_neto')::numeric;
  v_iva_nuevo := case
    when v_oc.manual then null
    when abs(v_rate - 0.21) < 0.005 then 21
    when abs(v_rate - 0.105) < 0.005 then 10.5
    when abs(v_rate) < 0.002 then 0
    else null end;
  v_pr_ids := (regexp_match(coalesce(v_oc.observaciones, ''), '\[PR_ITEMS:([^\]]+)\]'))[1];

  for v_it in
    select i.id, i.codigo, i.descripcion, i.precio_unitario, i.iva_porcentaje
    from orden_compra_items i where i.orden_id = p_oc_id order by i.orden
  loop
    v_nuevo := round(v_it.precio_unitario * v_factor, 2);
    if abs(v_nuevo - v_it.precio_unitario) < 0.005
       and (v_iva_nuevo is null or v_iva_nuevo = coalesce(v_it.iva_porcentaje, 21)) then
      continue;
    end if;

    insert into lz_oc_ajustes (sociedad_id, oc_id, oc_item_id, precio_anterior, precio_nuevo, iva_anterior, iva_nuevo, created_by)
    values (p_sociedad_id, p_oc_id, v_it.id, v_it.precio_unitario, v_nuevo, v_it.iva_porcentaje,
            coalesce(v_iva_nuevo, v_it.iva_porcentaje), auth.uid())
    returning id into v_ajuste_id;

    update orden_compra_items
    set precio_unitario = v_nuevo,
        iva_porcentaje = coalesce(v_iva_nuevo, iva_porcentaje)
    where id = v_it.id;
    v_ajustados := v_ajustados + 1;

    -- Costo en el PR (misma búsqueda que guardar_conciliacion_compra).
    if abs(v_nuevo - v_it.precio_unitario) < 0.005 then continue; end if;
    if v_pr_ids is null and v_oc.presupuesto_origen_id is null then continue; end if;
    v_pi := null;
    select pi.*, p.moneda as pr_moneda, p.tipo_cambio as pr_tc, p.tipo_cambio_divisas as pr_tcd, s.score,
           count(*) over (partition by s.score) as empatados
      into v_pi
      from presupuesto_items pi
      join presupuestos p on p.id = pi.presupuesto_id
      cross join lateral (select
          (case when nullif(btrim(pi.codigo),'') is not null and lower(btrim(pi.codigo)) = lower(btrim(v_it.codigo)) then 2 else 0 end)
        + (case when lower(btrim(pi.descripcion)) = lower(btrim(regexp_replace(v_it.descripcion, '\s*\[[^\]]*\]\s*$', ''))) then 1 else 0 end) as score) s
      where s.score > 0
        and ((v_pr_ids is not null and pi.id::text = any(string_to_array(replace(v_pr_ids,' ',''), ',')))
          or (v_pr_ids is null and pi.presupuesto_id = v_oc.presupuesto_origen_id))
      order by s.score desc
      limit 1;
    if v_pi.id is null or v_pi.empatados > 1 then
      v_sin_pr := array_append(v_sin_pr, v_it.descripcion);
      continue;
    end if;
    v_tc := case when coalesce(v_pi.pr_tc,0) > 0 then v_pi.pr_tc else coalesce(v_pi.pr_tcd,0) end;
    v_conv := case
      when replace(coalesce(v_pi.pr_moneda::text,'ARS'),' Divisa','') = replace(coalesce(v_oc.moneda,'ARS'),' Divisa','') then v_nuevo
      when v_tc > 0 and coalesce(v_oc.moneda,'ARS') like 'USD%' and coalesce(v_pi.pr_moneda::text,'ARS') = 'ARS' then v_nuevo * v_tc
      when v_tc > 0 and coalesce(v_oc.moneda,'ARS') = 'ARS' and coalesce(v_pi.pr_moneda::text,'ARS') like 'USD%' then v_nuevo / v_tc
      else null end;
    v_venta := coalesce(v_pi.precio_venta, v_pi.precio_costo * (1 + coalesce(v_pi.markup_porcentaje,0) / 100));
    if v_conv is null or v_conv <= 0 or v_venta is null then
      v_sin_pr := array_append(v_sin_pr, v_it.descripcion || ' (no se pudo convertir la moneda)');
      continue;
    end if;
    v_markup := round(((coalesce(v_pi.precio_lista, v_venta) / v_conv) - 1) * 100, 2);

    update lz_oc_ajustes
    set pr_item_id = v_pi.id, pr_costo_anterior = v_pi.precio_costo,
        pr_costo_moneda_anterior = v_pi.costo_moneda, pr_markup_anterior = v_pi.markup_porcentaje
    where id = v_ajuste_id;

    update presupuesto_items
    set precio_costo = v_nuevo, costo_moneda = coalesce(v_oc.moneda,'ARS'), markup_porcentaje = v_markup, precio_venta = v_venta
    where id = v_pi.id;
    v_pr_count := v_pr_count + 1;
    v_hist_pr := jsonb_set(v_hist_pr, array[v_pi.presupuesto_id::text], to_jsonb(
      coalesce((v_hist_pr->>(v_pi.presupuesto_id::text)) || '; ', '') || v_pi.descripcion || ': costo ' || v_pi.precio_costo || ' → ' || v_nuevo
      || ' (margen ' || coalesce(v_pi.markup_porcentaje,0) || '% → ' || v_markup || '%)'));
  end loop;

  if v_ajustados > 0 then
    update ordenes_compra
    set observaciones = coalesce(observaciones,'') || E'\n[' || to_char(now() at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY HH24:MI')
          || '] Ajustada a la factura: precios x ' || round(v_factor, 4)
          || case when v_iva_nuevo is not null then ', IVA ' || v_iva_nuevo || '%' else '' end
    where id = p_oc_id;
    for v_k in select jsonb_object_keys(v_hist_pr) loop
      update presupuestos
      set observaciones = coalesce(observaciones,'') || E'\n[' || to_char(now() at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY HH24:MI')
            || '] ' || v_oc.numero || ' ajustada a la factura: ' || (v_hist_pr->>v_k)
      where id = v_k::uuid;
    end loop;
  end if;

  perform public.lz_actualizar_fact_pago_oc(p_oc_id);

  return jsonb_build_object('ajustados', v_ajustados, 'pr_actualizados', v_pr_count, 'sin_pr', to_jsonb(v_sin_pr),
                            'factor', round(v_factor, 4), 'iva_nuevo', v_iva_nuevo);
end;
$$;

-- 3) Deshacer el ajuste ----------------------------------------------------------------------------------
create or replace function public.deshacer_ajuste_oc(p_sociedad_id uuid, p_oc_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n integer := 0;
  v_a record;
begin
  if not public.lz_tiene_rol(array['super_admin','admin','administrativo','vendedor'])
     or not public.lz_es_de_sociedad(p_sociedad_id) then
    raise exception 'No tenés permiso para modificar compras de esta sociedad' using errcode = '42501';
  end if;
  if not exists (select 1 from ordenes_compra where id = p_oc_id and sociedad_id = p_sociedad_id) then
    raise exception 'No se encontró la OC' using errcode = 'P0002';
  end if;

  for v_a in select * from lz_oc_ajustes where oc_id = p_oc_id and not deshecho order by created_at desc loop
    update orden_compra_items set precio_unitario = v_a.precio_anterior, iva_porcentaje = v_a.iva_anterior where id = v_a.oc_item_id;
    if v_a.pr_item_id is not null then
      update presupuesto_items
      set precio_costo = v_a.pr_costo_anterior, costo_moneda = v_a.pr_costo_moneda_anterior, markup_porcentaje = v_a.pr_markup_anterior
      where id = v_a.pr_item_id;
    end if;
    update lz_oc_ajustes set deshecho = true where id = v_a.id;
    v_n := v_n + 1;
  end loop;

  if v_n > 0 then
    update ordenes_compra
    set observaciones = coalesce(observaciones,'') || E'\n[' || to_char(now() at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY HH24:MI')
          || '] Se deshizo el ajuste a la factura'
    where id = p_oc_id;
  end if;
  perform public.lz_actualizar_fact_pago_oc(p_oc_id);
  return v_n;
end;
$$;

revoke all on function public.diagnostico_diferencia_oc(uuid, uuid) from public, anon;
revoke all on function public.ajustar_oc_a_factura(uuid, uuid) from public, anon;
revoke all on function public.deshacer_ajuste_oc(uuid, uuid) from public, anon;
grant execute on function public.diagnostico_diferencia_oc(uuid, uuid) to authenticated;
grant execute on function public.ajustar_oc_a_factura(uuid, uuid) to authenticated;
grant execute on function public.deshacer_ajuste_oc(uuid, uuid) to authenticated;

-- 4) Cerrar / reabrir saldo: pago al día y aviso al vendedor del PR ------------------------------------------
create or replace function public.lz_trg_saldo_cerrado_oc()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pr record;
begin
  perform public.lz_actualizar_fact_pago_oc(NEW.id);

  if coalesce(NEW.saldo_cerrado, false) and not coalesce(OLD.saldo_cerrado, false) and NEW.presupuesto_origen_id is not null then
    select id, numero, coalesce(vendedor_id, created_by) as vendedor into v_pr from presupuestos where id = NEW.presupuesto_origen_id;
    if v_pr.vendedor is not null then
      insert into alertas (sociedad_id, user_id, tipo, module, entity_type, entity_id, title, description, read)
      values (NEW.sociedad_id, v_pr.vendedor, 'oc_pendiente', 'presupuestos', 'presupuesto', v_pr.id,
              NEW.numero || ' cerrada sin recibir/facturar todo (' || v_pr.numero || ')',
              coalesce(nullif(NEW.saldo_cerrado_motivo, ''), 'El proveedor no va a entregar el resto')
                || '. Revisá si hay que avisarle al cliente o ajustar el PR.',
              false);
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists lz_saldo_cerrado_oc on public.ordenes_compra;
create trigger lz_saldo_cerrado_oc
  after update of saldo_cerrado on public.ordenes_compra
  for each row
  when (OLD.saldo_cerrado is distinct from NEW.saldo_cerrado)
  execute function public.lz_trg_saldo_cerrado_oc();

commit;
