-- Costos y márgenes de ajustes de factura: de "observaciones" (sale impreso en el PDF del cliente) a "notas_internas" (solo interno).
--
-- Qué hace (aditivo, sin borrar nada: lo movido queda en notas_internas y todo en un respaldo):
--  1) Respaldo de observaciones y notas_internas de los presupuestos afectados -> tabla lz_backup_pr_obs_20261014.
--  2) Mueve a notas_internas los renglones automáticos que están en observaciones: los que empiezan con la fecha entre corchetes,
--     como "[09/10/2026 07:05] FC 0002-00036698: ... costo 37259 -> 37529 (margen 43.59% -> 42.56%)".
--     Lo que escribió una persona en observaciones queda igual. (Al 14/10: 14 presupuestos, 16 renglones.)
--  3) guardar_conciliacion_compra y ajustar_oc_a_factura dejan de escribir ese historial en observaciones del presupuesto: ahora usan notas_internas.
--     Son las definiciones VIVAS de la base con solo ese cambio. Las observaciones de la OC no se tocan.
--
-- Vuelta atrás: supabase/rollback/20261014140000_pr_costos_a_notas_internas.sql (restaura las 2 funciones y los textos desde el respaldo).
begin;

create table if not exists public.lz_backup_pr_obs_20261014 (
  presupuesto_id uuid primary key,
  observaciones_antes text,
  notas_internas_antes text,
  respaldado_at timestamptz not null default now()
);
alter table public.lz_backup_pr_obs_20261014 enable row level security;
revoke all on public.lz_backup_pr_obs_20261014 from anon, authenticated;

insert into public.lz_backup_pr_obs_20261014 (presupuesto_id, observaciones_antes, notas_internas_antes)
select p.id, p.observaciones, p.notas_internas
from public.presupuestos p
where exists (
  select 1 from regexp_split_to_table(coalesce(p.observaciones, ''), E'\n') as t(linea)
  where t.linea ~ '^\s*\[\d{1,2}/\d{1,2}/\d{2,4}[\s,\]]'
)
on conflict (presupuesto_id) do nothing;

with partes as (
  select p.id,
         string_agg(l.linea, E'\n' order by l.n) filter (where l.auto)     as auto_lineas,
         string_agg(l.linea, E'\n' order by l.n) filter (where not l.auto) as resto
  from public.presupuestos p,
       lateral (select t.linea, t.n, t.linea ~ '^\s*\[\d{1,2}/\d{1,2}/\d{2,4}[\s,\]]' as auto
                from regexp_split_to_table(coalesce(p.observaciones, ''), E'\n') with ordinality as t(linea, n)) l
  group by p.id
  having bool_or(l.auto)
)
update public.presupuestos p
set observaciones = nullif(btrim(coalesce(partes.resto, ''), E'\n\r '), ''),
    notas_internas = case when coalesce(p.notas_internas, '') = '' then partes.auto_lineas
                          else p.notas_internas || E'\n' || partes.auto_lineas end
from partes
where p.id = partes.id;

-- 3) Funciones (definiciones vivas con el cambio a notas_internas) -----------------------------------------
CREATE OR REPLACE FUNCTION public.guardar_conciliacion_compra(p_sociedad_id uuid, p_factura_id uuid, p_factura jsonb, p_items jsonb, p_asignaciones jsonb, p_borrador boolean, p_aceptar_costos boolean, p_equivalencias jsonb, p_confirmar boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
  -- (se recalcula el margen) y dejando el historial en las NOTAS INTERNAS del presupuesto (Observaciones sale impreso para el cliente).
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
      update public.presupuestos set notas_internas = coalesce(notas_internas,'') || E'\n[' || to_char(now() at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY HH24:MI') || '] FC ' || v_numero || ': ' || (v_pr_hist->>v_k)
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
$function$
;

CREATE OR REPLACE FUNCTION public.ajustar_oc_a_factura(p_sociedad_id uuid, p_oc_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
      set notas_internas = coalesce(notas_internas,'') || E'\n[' || to_char(now() at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY HH24:MI')
            || '] ' || v_oc.numero || ' ajustada a la factura: ' || (v_hist_pr->>v_k)
      where id = v_k::uuid;
    end loop;
  end if;

  perform public.lz_actualizar_fact_pago_oc(p_oc_id);

  return jsonb_build_object('ajustados', v_ajustados, 'pr_actualizados', v_pr_count, 'sin_pr', to_jsonb(v_sin_pr),
                            'factor', round(v_factor, 4), 'iva_nuevo', v_iva_nuevo);
end;
$function$
;

commit;
