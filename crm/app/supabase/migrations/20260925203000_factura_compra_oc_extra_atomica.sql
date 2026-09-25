-- Registra el núcleo contable de una factura de mercadería con una OC por
-- cantidades extra en una sola transacción. Una excepción revierte factura,
-- ítems, vínculos, OC extra y sus ítems.
create or replace function public.registrar_factura_compra_con_oc_extra(
  p_sociedad_id uuid,
  p_factura jsonb,
  p_items jsonb,
  p_orden_compra_ids uuid[],
  p_items_extra jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_user uuid := auth.uid();
  v_proveedor_id uuid;
  v_factura_id uuid;
  v_oc_extra_id uuid;
  v_numero text;
  v_numero_normalizado text;
  v_partes text[];
  v_fecha date;
  v_fecha_vencimiento date;
  v_moneda public.moneda_type;
  v_estado text;
  v_tipo_comprobante text;
  v_subtotal numeric;
  v_iva_porcentaje numeric;
  v_iva numeric;
  v_percepciones numeric;
  v_total numeric;
  v_item jsonb;
  v_descripcion text;
  v_codigo text;
  v_unidad text;
  v_cantidad numeric;
  v_precio numeric;
  v_descuento numeric;
  v_item_iva numeric;
  v_extra_subtotal numeric := 0;
  v_extra_iva numeric := 0;
  v_orden integer := 0;
  v_count integer;
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
    raise exception 'No tenés autorización para registrar compras en esta sociedad' using errcode = '42501';
  end if;

  if p_sociedad_id is null
    or p_factura is null or jsonb_typeof(p_factura) <> 'object'
    or p_items is null or jsonb_typeof(p_items) <> 'array'
    or p_items_extra is null or jsonb_typeof(p_items_extra) <> 'array'
    or p_orden_compra_ids is null
    or jsonb_array_length(p_items) > 500
    or jsonb_array_length(p_items_extra) = 0
    or jsonb_array_length(p_items_extra) > 500
    or coalesce(cardinality(p_orden_compra_ids), 0) = 0
  then
    raise exception 'Datos incompletos para registrar la factura y su OC extra' using errcode = '22023';
  end if;

  begin
    v_proveedor_id := nullif(p_factura->>'proveedor_id', '')::uuid;
    v_numero := btrim(coalesce(p_factura->>'numero_factura', ''));
    v_fecha := (p_factura->>'fecha')::date;
    v_fecha_vencimiento := nullif(p_factura->>'fecha_vencimiento', '')::date;
    v_moneda := p_factura->>'moneda';
    v_estado := p_factura->>'estado';
    v_tipo_comprobante := btrim(coalesce(p_factura->>'tipo_comprobante', ''));
    v_subtotal := (p_factura->>'subtotal')::numeric;
    v_iva_porcentaje := (p_factura->>'iva_porcentaje')::numeric;
    v_iva := (p_factura->>'iva')::numeric;
    v_percepciones := (p_factura->>'percepciones')::numeric;
    v_total := (p_factura->>'total')::numeric;
  exception when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range then
    raise exception 'Los datos de la factura tienen un formato inválido' using errcode = '22023';
  end;

  if v_proveedor_id is null or v_numero = '' or v_tipo_comprobante = ''
    or v_moneda not in ('ARS', 'USD')
    or v_estado not in ('pagada', 'pendiente_aprobacion')
    or coalesce(p_factura->>'tipo', '') <> 'mercaderia'
    or v_subtotal < 0 or v_iva < 0 or v_percepciones < 0 or v_total <= 0
    or v_iva_porcentaje < 0 or v_iva_porcentaje > 100
  then
    raise exception 'Los datos de la factura son inválidos' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.proveedores
    where id = v_proveedor_id and sociedad_id = p_sociedad_id
  ) then
    raise exception 'El proveedor no pertenece a la sociedad seleccionada' using errcode = '22023';
  end if;

  select count(*) into v_count
  from (select distinct id from unnest(p_orden_compra_ids) as ids(id)) selected;
  if v_count <> cardinality(p_orden_compra_ids) then
    raise exception 'La selección de OC contiene duplicados' using errcode = '22023';
  end if;

  -- Bloquea las OC en orden estable y vuelve a validar los datos que impactan
  -- la conciliación. No se confía en el estado que leyó previamente el navegador.
  perform 1
  from public.ordenes_compra
  where id = any(p_orden_compra_ids)
  order by id
  for update;

  select count(*) into v_count
  from public.ordenes_compra
  where id = any(p_orden_compra_ids)
    and sociedad_id = p_sociedad_id
    and proveedor_id = v_proveedor_id
    and moneda::text = v_moneda::text
    and estado::text not in ('cancelada', 'borrador');
  if v_count <> cardinality(p_orden_compra_ids) then
    raise exception 'Las OC deben estar activas y pertenecer al proveedor, sociedad y moneda de la factura' using errcode = '22023';
  end if;

  -- Serializa altas equivalentes para evitar dos facturas del mismo proveedor
  -- y número cuando dos pestañas confirman simultáneamente.
  v_numero_normalizado := upper(regexp_replace(v_numero, '\s+', '', 'g'));
  v_partes := regexp_match(v_numero_normalizado, '^([0-9]{1,5})[-/]([0-9]{1,8})$');
  if v_partes is not null then
    v_numero_normalizado := lpad(v_partes[1], 5, '0') || '-' || lpad(v_partes[2], 8, '0');
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_sociedad_id::text || ':' || v_proveedor_id::text || ':' || v_numero_normalizado, 0));

  if exists (
    select 1
    from public.facturas_compra fc
    left join lateral regexp_match(
      upper(regexp_replace(btrim(fc.numero_factura), '\s+', '', 'g')),
      '^([0-9]{1,5})[-/]([0-9]{1,8})$'
    ) as parsed(parts) on true
    where fc.sociedad_id = p_sociedad_id
      and fc.proveedor_id = v_proveedor_id
      and (
        case
          when parsed.parts is not null then lpad(parsed.parts[1], 5, '0') || '-' || lpad(parsed.parts[2], 8, '0')
          else upper(regexp_replace(btrim(fc.numero_factura), '\s+', '', 'g'))
        end
      ) = v_numero_normalizado
  ) then
    raise exception 'La factura % de este proveedor ya está cargada', v_numero using errcode = '23505';
  end if;

  -- Se validan todos los renglones antes de escribir la primera fila.
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(v_item) <> 'object'
      or jsonb_typeof(v_item->'cantidad') <> 'number'
      or jsonb_typeof(v_item->'precio_unitario') <> 'number'
      or jsonb_typeof(v_item->'descuento_porcentaje') <> 'number'
      or jsonb_typeof(v_item->'iva_porcentaje') <> 'number'
    then
      raise exception 'Un ítem de factura tiene un formato inválido' using errcode = '22023';
    end if;
    v_descripcion := btrim(coalesce(v_item->>'descripcion', ''));
    v_cantidad := (v_item->>'cantidad')::numeric;
    v_precio := (v_item->>'precio_unitario')::numeric;
    v_descuento := (v_item->>'descuento_porcentaje')::numeric;
    v_item_iva := (v_item->>'iva_porcentaje')::numeric;
    if v_descripcion = '' or v_cantidad <= 0 or v_precio < 0
      or v_descuento < 0 or v_descuento > 100 or v_item_iva < 0 or v_item_iva > 100
    then
      raise exception 'Un ítem de factura tiene valores inválidos' using errcode = '22023';
    end if;
  end loop;

  for v_item in select value from jsonb_array_elements(p_items_extra)
  loop
    if jsonb_typeof(v_item) <> 'object'
      or jsonb_typeof(v_item->'cantidad') <> 'number'
      or jsonb_typeof(v_item->'precio_unitario') <> 'number'
      or jsonb_typeof(v_item->'iva_porcentaje') <> 'number'
    then
      raise exception 'Un ítem extra tiene un formato inválido' using errcode = '22023';
    end if;
    v_descripcion := btrim(coalesce(v_item->>'descripcion', ''));
    v_cantidad := (v_item->>'cantidad')::numeric;
    v_precio := (v_item->>'precio_unitario')::numeric;
    v_item_iva := (v_item->>'iva_porcentaje')::numeric;
    if v_descripcion = '' or v_cantidad <= 0 or v_precio < 0 or v_item_iva < 0 or v_item_iva > 100 then
      raise exception 'Un ítem extra tiene valores inválidos' using errcode = '22023';
    end if;
    v_extra_subtotal := v_extra_subtotal + v_cantidad * v_precio;
    v_extra_iva := v_extra_iva + v_cantidad * v_precio * v_item_iva / 100;
  end loop;

  v_extra_subtotal := round(v_extra_subtotal, 2);
  v_extra_iva := round(v_extra_iva, 2);

  insert into public.facturas_compra (
    numero_factura, tipo_comprobante, proveedor_id, fecha, fecha_vencimiento,
    subtotal, iva_porcentaje, iva, percepciones, total, moneda, estado, tipo,
    solo_iva, notas, cae, sociedad_id, created_by
  ) values (
    v_numero, v_tipo_comprobante, v_proveedor_id, v_fecha, v_fecha_vencimiento,
    v_subtotal, v_iva_porcentaje, v_iva, v_percepciones, v_total, v_moneda,
    v_estado, 'mercaderia', false, nullif(p_factura->>'notas', ''),
    nullif(p_factura->>'cae', ''), p_sociedad_id, v_user
  ) returning id into v_factura_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    insert into public.facturas_compra_items (
      factura_compra_id, producto_id, codigo, descripcion, cantidad,
      precio_unitario, descuento_porcentaje, unidad, iva_porcentaje, sociedad_id
    ) values (
      v_factura_id, null, nullif(v_item->>'codigo', ''), btrim(v_item->>'descripcion'),
      (v_item->>'cantidad')::numeric, (v_item->>'precio_unitario')::numeric,
      (v_item->>'descuento_porcentaje')::numeric, coalesce(nullif(v_item->>'unidad', ''), 'u'),
      (v_item->>'iva_porcentaje')::numeric, p_sociedad_id
    );
  end loop;

  insert into public.factura_compra_ocs (factura_compra_id, orden_compra_id)
  select v_factura_id, id from unnest(p_orden_compra_ids) as ids(id);

  insert into public.ordenes_compra (
    proveedor_id, fecha, moneda, estado, estado_pago, subtotal, iva, total,
    sociedad_id, presupuesto_origen_id, observaciones, created_by
  ) values (
    v_proveedor_id, v_fecha, v_moneda, 'enviada', 'pendiente',
    v_extra_subtotal, v_extra_iva, round(v_extra_subtotal + v_extra_iva, 2),
    p_sociedad_id, null, 'OC generada automáticamente por extras de FC ' || v_numero, v_user
  ) returning id into v_oc_extra_id;

  v_orden := 0;
  for v_item in select value from jsonb_array_elements(p_items_extra)
  loop
    v_codigo := coalesce(v_item->>'codigo', '');
    v_descripcion := btrim(v_item->>'descripcion');
    v_unidad := coalesce(nullif(v_item->>'unidad', ''), 'u');
    v_cantidad := (v_item->>'cantidad')::numeric;
    v_precio := (v_item->>'precio_unitario')::numeric;
    v_item_iva := (v_item->>'iva_porcentaje')::numeric;
    insert into public.orden_compra_items (
      orden_id, codigo, descripcion, cantidad, cantidad_recibida, unidad,
      precio_unitario, iva_porcentaje, orden
    ) values (
      v_oc_extra_id, v_codigo, v_descripcion, v_cantidad, v_cantidad, v_unidad,
      v_precio, v_item_iva, v_orden
    );
    v_orden := v_orden + 1;
  end loop;

  insert into public.factura_compra_ocs (factura_compra_id, orden_compra_id)
  values (v_factura_id, v_oc_extra_id);

  return jsonb_build_object(
    'factura_compra_id', v_factura_id,
    'orden_compra_extra_id', v_oc_extra_id,
    'subtotal_extra', v_extra_subtotal,
    'iva_extra', v_extra_iva,
    'total_extra', round(v_extra_subtotal + v_extra_iva, 2)
  );
end;
$$;

revoke all on function public.registrar_factura_compra_con_oc_extra(uuid,jsonb,jsonb,uuid[],jsonb) from public, anon;
grant execute on function public.registrar_factura_compra_con_oc_extra(uuid,jsonb,jsonb,uuid[],jsonb) to authenticated;

comment on function public.registrar_factura_compra_con_oc_extra(uuid,jsonb,jsonb,uuid[],jsonb) is
  'Registra atómicamente una factura de compra de mercadería, sus ítems y vínculos, más la OC enviada que respalda cantidades extra.';
