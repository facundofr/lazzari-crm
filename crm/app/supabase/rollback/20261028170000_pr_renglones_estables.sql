-- Vuelta atrás de 20261028170000_pr_renglones_estables.sql: deja actualizar_presupuesto_atomico y crear_presupuesto_atomico
-- exactamente como estaban el 28/10/2026 (editar vuelve a borrar y recrear los renglones). No toca datos.
begin;

CREATE OR REPLACE FUNCTION public.actualizar_presupuesto_atomico(p_presupuesto_id uuid, p_sociedad_id uuid, p_update jsonb, p_items jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_update public.presupuestos%rowtype;
  v_id uuid;
begin
  if p_presupuesto_id is null
    or p_sociedad_id is null
    or p_update is null or jsonb_typeof(p_update) <> 'object'
    or p_items is null or jsonb_typeof(p_items) <> 'array'
    or jsonb_array_length(p_items) = 0
    or jsonb_array_length(p_items) > 500
  then
    raise exception 'Datos incompletos para actualizar el presupuesto' using errcode = '22023';
  end if;

  select * into v_update
  from jsonb_populate_record(null::public.presupuestos, p_update);

  perform 1
  from public.presupuestos
  where id = p_presupuesto_id and sociedad_id = p_sociedad_id
  for update;
  if not found then
    raise exception 'No se encontro el presupuesto en la sociedad seleccionada' using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from jsonb_populate_recordset(null::public.presupuesto_items, p_items) item
    where btrim(coalesce(item.descripcion, '')) = ''
      or coalesce(item.cantidad, 0) <= 0
      or coalesce(item.precio_costo, 0) < 0
      or coalesce(item.precio_venta, 0) < 0
      or coalesce(item.markup_porcentaje, 0) < 0
      or coalesce(item.iva_porcentaje, 0) < 0
  ) then
    raise exception 'Uno o mas items del presupuesto son invalidos' using errcode = '22023';
  end if;

  update public.presupuestos p
  set cliente_id = v_update.cliente_id,
      vendedor_id = v_update.vendedor_id,
      sucursal_id = v_update.sucursal_id,
      contacto_id = v_update.contacto_id,
      markup_general = v_update.markup_general,
      subtotal = v_update.subtotal,
      iva = v_update.iva,
      total = v_update.total,
      moneda = v_update.moneda,
      tipo_cambio = v_update.tipo_cambio,
      tipo_cambio_divisas = v_update.tipo_cambio_divisas,
      cotizacion_modalidad = v_update.cotizacion_modalidad,
      observaciones = v_update.observaciones,
      notas_internas = v_update.notas_internas,
      vencimiento = v_update.vencimiento,
      tipo_comprobante = v_update.tipo_comprobante,
      modalidad_emision = v_update.modalidad_emision,
      estado = case when p_update ? 'estado' then v_update.estado else p.estado end,
      enviado_at = case when p_update ? 'enviado_at' then v_update.enviado_at else p.enviado_at end
  where p.id = p_presupuesto_id
    and p.sociedad_id = p_sociedad_id
  returning p.id into v_id;

  delete from public.presupuesto_items
  where presupuesto_id = p_presupuesto_id;

  insert into public.presupuesto_items (
    presupuesto_id, producto_id, codigo, descripcion, categoria, cantidad,
    unidad, precio_costo, markup_porcentaje, precio_venta, iva_porcentaje,
    orden, proveedor_id, stock_propio, lista_item_id, proveedor_nombre,
    costo_moneda
  )
  select
    p_presupuesto_id, item.producto_id, coalesce(item.codigo, ''),
    btrim(item.descripcion), item.categoria, item.cantidad,
    coalesce(nullif(item.unidad, ''), 'u'), coalesce(item.precio_costo, 0),
    coalesce(item.markup_porcentaje, 0), coalesce(item.precio_venta, 0),
    coalesce(item.iva_porcentaje, 21), item.orden, item.proveedor_id,
    coalesce(item.stock_propio, false), item.lista_item_id,
    item.proveedor_nombre, coalesce(nullif(item.costo_moneda, ''), 'ARS')
  from jsonb_populate_recordset(null::public.presupuesto_items, p_items) item;

  return v_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.crear_presupuesto_atomico(p_sociedad_id uuid, p_presupuesto jsonb, p_items jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_new public.presupuestos%rowtype;
  v_id uuid;
begin
  if p_sociedad_id is null
    or p_presupuesto is null or jsonb_typeof(p_presupuesto) <> 'object'
    or p_items is null or jsonb_typeof(p_items) <> 'array'
    or jsonb_array_length(p_items) = 0
    or jsonb_array_length(p_items) > 500
  then
    raise exception 'Datos incompletos para crear el presupuesto' using errcode = '22023';
  end if;

  select * into v_new
  from jsonb_populate_record(null::public.presupuestos, p_presupuesto);

  if exists (
    select 1
    from jsonb_populate_recordset(null::public.presupuesto_items, p_items) item
    where btrim(coalesce(item.descripcion, '')) = ''
      or coalesce(item.cantidad, 0) <= 0
      or coalesce(item.precio_costo, 0) < 0
      or coalesce(item.precio_venta, 0) < 0
      or coalesce(item.markup_porcentaje, 0) < 0
      or coalesce(item.iva_porcentaje, 0) < 0
  ) then
    raise exception 'Uno o mas items del presupuesto son invalidos' using errcode = '22023';
  end if;

  insert into public.presupuestos (
    cliente_id, vendedor_id, sucursal_id, contacto_id, created_by,
    sociedad_id, fecha, vencimiento, estado, enviado_at, markup_general,
    subtotal, iva, total, moneda, tipo_cambio, tipo_cambio_divisas,
    cotizacion_modalidad, observaciones, notas_internas, tipo_comprobante,
    modalidad_emision
  ) values (
    v_new.cliente_id, v_new.vendedor_id, v_new.sucursal_id, v_new.contacto_id,
    v_new.created_by, p_sociedad_id, v_new.fecha, v_new.vencimiento,
    v_new.estado, v_new.enviado_at, v_new.markup_general, v_new.subtotal,
    v_new.iva, v_new.total, v_new.moneda, v_new.tipo_cambio,
    v_new.tipo_cambio_divisas, v_new.cotizacion_modalidad,
    v_new.observaciones, v_new.notas_internas, v_new.tipo_comprobante,
    v_new.modalidad_emision
  ) returning id into v_id;

  insert into public.presupuesto_items (
    presupuesto_id, producto_id, codigo, descripcion, categoria, cantidad,
    unidad, precio_costo, markup_porcentaje, precio_venta, iva_porcentaje,
    orden, proveedor_id, stock_propio, lista_item_id, proveedor_nombre,
    costo_moneda
  )
  select
    v_id, item.producto_id, coalesce(item.codigo, ''),
    btrim(item.descripcion), item.categoria, item.cantidad,
    coalesce(nullif(item.unidad, ''), 'u'), coalesce(item.precio_costo, 0),
    coalesce(item.markup_porcentaje, 0), coalesce(item.precio_venta, 0),
    coalesce(item.iva_porcentaje, 21), item.orden, item.proveedor_id,
    coalesce(item.stock_propio, false), item.lista_item_id,
    item.proveedor_nombre, coalesce(nullif(item.costo_moneda, ''), 'ARS')
  from jsonb_populate_recordset(null::public.presupuesto_items, p_items) item;

  return v_id;
end;
$function$
;

commit;
