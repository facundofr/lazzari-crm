-- Conciliación de facturas de compra contra OC, por línea.
--
-- Cambios ADITIVOS: no borra ni modifica datos existentes.
--  1. Estado de factura "en_conciliacion" (conciliación parcial: no va a pagos).
--  2. ordenes_compra.estado_facturacion: parcial / facturada.
--  3. factura_compra_asignaciones: qué cantidad de cada línea de OC cubre cada línea de factura.
--  4. proveedor_equivalencias: equivalencias de artículos aprendidas por proveedor.
--  5. Vista orden_compra_items_pendientes: cantidad pendiente de facturar por línea de OC.
--  6. Función guardar_conciliacion_compra: guarda todo en una sola transacción y, al confirmar,
--     actualiza el costo de la OC y del presupuesto de origen (mantiene el precio de venta).
--     Pueden usarla super_admin, admin, administrativo y vendedor.
-- Para deshacer: supabase/rollback/20261009120000_conciliacion_compras.sql

-- 1) Nuevo estado posible (se agrega a la lista; los existentes no cambian)
alter table public.facturas_compra drop constraint if exists facturas_compra_estado_check;
alter table public.facturas_compra add constraint facturas_compra_estado_check
  check (estado = any (array['pendiente','pagada','anulada','recibida','pendiente_aprobacion','en_conciliacion']));

-- 2) Estado de facturación de la OC (independiente del estado de recepción)
alter table public.ordenes_compra add column if not exists estado_facturacion text;
alter table public.ordenes_compra drop constraint if exists ordenes_compra_estado_facturacion_check;
alter table public.ordenes_compra add constraint ordenes_compra_estado_facturacion_check
  check (estado_facturacion is null or estado_facturacion in ('parcial','facturada'));

-- 3) Asignaciones por línea
create table if not exists public.factura_compra_asignaciones (
  id uuid primary key default gen_random_uuid(),
  sociedad_id uuid not null references public.sociedades(id),
  factura_compra_id uuid not null references public.facturas_compra(id) on delete cascade,
  factura_compra_item_id uuid not null references public.facturas_compra_items(id) on delete cascade,
  orden_compra_id uuid not null references public.ordenes_compra(id) on delete cascade,
  orden_compra_item_id uuid not null references public.orden_compra_items(id) on delete cascade,
  cantidad numeric not null check (cantidad > 0),
  precio_factura numeric not null,
  precio_oc numeric not null,
  origen text not null default 'manual',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists fca_oc_item_idx on public.factura_compra_asignaciones (orden_compra_item_id);
create index if not exists fca_factura_idx on public.factura_compra_asignaciones (factura_compra_id);
create index if not exists fca_oc_idx on public.factura_compra_asignaciones (orden_compra_id);
alter table public.factura_compra_asignaciones enable row level security;
drop policy if exists fca_select on public.factura_compra_asignaciones;
create policy fca_select on public.factura_compra_asignaciones for select to authenticated
  using (public.get_my_role() = any (array['super_admin','admin','administrativo','vendedor','viewer']::public.user_role[]));

-- 4) Equivalencias aprendidas por proveedor
create table if not exists public.proveedor_equivalencias (
  id uuid primary key default gen_random_uuid(),
  sociedad_id uuid not null references public.sociedades(id),
  proveedor_id uuid not null references public.proveedores(id) on delete cascade,
  producto_factura text not null,
  producto_oc text not null,
  codigo_proveedor text,
  veces integer not null default 1,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sociedad_id, proveedor_id, producto_factura, producto_oc)
);
alter table public.proveedor_equivalencias enable row level security;
drop policy if exists pe_select on public.proveedor_equivalencias;
create policy pe_select on public.proveedor_equivalencias for select to authenticated
  using (public.get_my_role() = any (array['super_admin','admin','administrativo','vendedor','viewer']::public.user_role[]));
drop policy if exists pe_delete on public.proveedor_equivalencias;
create policy pe_delete on public.proveedor_equivalencias for delete to authenticated
  using (public.get_my_role() = any (array['super_admin','admin','administrativo','vendedor']::public.user_role[]));

-- 5) Pendiente de facturar por línea de OC
create or replace view public.orden_compra_items_pendientes with (security_invoker = true) as
select i.id, i.orden_id, i.codigo, i.descripcion, i.cantidad, i.precio_unitario, i.iva_porcentaje, i.unidad, i.orden,
       coalesce(a.asignada, 0) as cantidad_asignada,
       i.cantidad - coalesce(a.asignada, 0) as cantidad_pendiente
from public.orden_compra_items i
left join (
  select orden_compra_item_id, sum(cantidad) as asignada
  from public.factura_compra_asignaciones group by orden_compra_item_id
) a on a.orden_compra_item_id = i.id;
grant select on public.orden_compra_items_pendientes to authenticated;

-- 6) Guardado atómico de la conciliación
create or replace function public.guardar_conciliacion_compra(
  p_sociedad_id uuid,
  p_factura_id uuid,          -- null = factura nueva; id = retomar una conciliación parcial
  p_factura jsonb,            -- encabezado
  p_items jsonb,              -- [{key, codigo, descripcion, cantidad, precio_unitario, descuento_porcentaje, iva_porcentaje, unidad}]
  p_asignaciones jsonb,       -- [{key, orden_compra_item_id, cantidad, precio_factura, precio_oc, origen}]
  p_borrador boolean,         -- true = "Conciliación parcial" (no va a pagos)
  p_aceptar_costos boolean,   -- true = actualizar el costo de la OC al precio facturado
  p_equivalencias jsonb       -- [{producto_factura, producto_oc, codigo_proveedor}]
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

  -- Número duplicado del mismo proveedor (ignora la propia factura si se está retomando)
  v_norm := upper(regexp_replace(v_numero, '\s+', '', 'g'));
  v_partes := regexp_match(v_norm, '^([0-9]{1,5})[-/]([0-9]{1,8})$');
  if v_partes is not null then v_norm := lpad(v_partes[1],5,'0') || '-' || lpad(v_partes[2],8,'0'); end if;
  perform pg_advisory_xact_lock(hashtextextended(p_sociedad_id::text || ':' || v_proveedor_id::text || ':' || v_norm, 0));
  if exists (
    select 1 from public.facturas_compra fc
    left join lateral regexp_match(upper(regexp_replace(btrim(fc.numero_factura), '\s+', '', 'g')), '^([0-9]{1,5})[-/]([0-9]{1,8})$') as p(parts) on true
    where fc.sociedad_id = p_sociedad_id and fc.proveedor_id = v_proveedor_id
      and fc.estado <> 'anulada'
      and fc.id is distinct from p_factura_id
      and (case when p.parts is null then upper(regexp_replace(btrim(fc.numero_factura), '\s+', '', 'g'))
                else lpad(p.parts[1],5,'0') || '-' || lpad(p.parts[2],8,'0') end) = v_norm
  ) then
    raise exception 'La factura % de este proveedor ya está cargada', v_numero using errcode = '23505';
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

  -- Nunca facturar más de lo pedido en una línea de OC (sumando todas las facturas)
  select i.descripcion, i.cantidad, sum(a.cantidad) as asignada into v_exceso
    from public.factura_compra_asignaciones a join public.orden_compra_items i on i.id = a.orden_compra_item_id
    where a.orden_compra_item_id in (select orden_compra_item_id from public.factura_compra_asignaciones where factura_compra_id = v_factura_id)
    group by i.id, i.descripcion, i.cantidad
    having sum(a.cantidad) > i.cantidad + 0.0001
    limit 1;
  if v_exceso.descripcion is not null then
    raise exception 'La línea de OC «%» quedaría con % facturadas de % pedidas. Revisá la asignación.', v_exceso.descripcion, v_exceso.asignada, v_exceso.cantidad using errcode = '22023';
  end if;

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
        v_markup := round(((v_venta / v_conv) - 1) * 100, 2);
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
    left join (select orden_compra_item_id, sum(cantidad) as asignada from public.factura_compra_asignaciones group by orden_compra_item_id) a
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
    'sin_presupuesto', to_jsonb(v_sin_pr));
end;
$$;

revoke all on function public.guardar_conciliacion_compra(uuid, uuid, jsonb, jsonb, jsonb, boolean, boolean, jsonb) from public, anon;
grant execute on function public.guardar_conciliacion_compra(uuid, uuid, jsonb, jsonb, jsonb, boolean, boolean, jsonb) to authenticated;
