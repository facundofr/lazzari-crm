-- Presupuestos: editar un PR ya no borra y recrea sus renglones (auditoría integral 28/10/2026, Tanda 4, H06 y H07;
-- Augusto: "Sí, dale").
-- Antes, al guardar la edición se borraban TODOS los renglones y se volvían a crear con id nuevo: las OC, los remitos,
-- la personalización y los ajustes de OC perdían el vínculo con su renglón (hoy 35 renglones de OC y 47 de remito
-- quedaron sueltos). Además se perdían el precio de lista, el descuento del renglón y el descuento general del PR.
-- Ahora actualizar_presupuesto_atomico:
--   * renglón que viene con su id (del mismo PR) → se ACTUALIZA en su lugar (conserva id, entregado, facturado y lo de la IA);
--   * renglón sin id (nuevo) → se agrega;
--   * renglón del PR que ya no viene → se borra (como antes).
--   Si dos renglones vienen con el mismo id (renglón copiado), el primero se actualiza y el otro se agrega como nuevo.
-- crear_presupuesto_atomico y actualizar guardan también precio_lista, descuento_porcentaje y descuento_general_porcentaje;
-- los datos de la IA (pedido_texto, catalogo_id, proveedor_sugerido_id, ia_confianza, ia_nota) se guardan si vienen
-- y, al editar, si no vienen se conservan.
-- No toca datos: solo cambia las dos funciones (mismos parámetros y permisos).
-- Vuelta atrás: supabase/rollback/20261028170000_pr_renglones_estables.sql
-- Prueba: scripts/db/pruebas/pr_renglones_estables.sql
begin;

create or replace function public.actualizar_presupuesto_atomico(p_presupuesto_id uuid, p_sociedad_id uuid, p_update jsonb, p_items jsonb)
 returns uuid
 language plpgsql
 set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_update public.presupuestos%rowtype;
  v_id uuid;
  v_renglones jsonb;
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
      descuento_general_porcentaje = case when p_update ? 'descuento_general_porcentaje'
        then coalesce(v_update.descuento_general_porcentaje, 0) else p.descuento_general_porcentaje end,
      estado = case when p_update ? 'estado' then v_update.estado else p.estado end,
      enviado_at = case when p_update ? 'enviado_at' then v_update.enviado_at else p.enviado_at end
  where p.id = p_presupuesto_id
    and p.sociedad_id = p_sociedad_id
  returning p.id into v_id;

  -- Renglones que llegan, en orden, con el id solo si es de este PR y es la primera vez que aparece.
  select coalesce(jsonb_agg(jsonb_build_object('ord', x.ord, 'elem', x.elem,
      'item_id', case when x.rn = 1 and exists (select 1 from public.presupuesto_items pi where pi.id = x.cand and pi.presupuesto_id = p_presupuesto_id)
        then x.cand end) order by x.ord), '[]'::jsonb)
  into v_renglones
  from (
    select e.ord::int as ord, e.elem, c.cand,
      row_number() over (partition by c.cand order by e.ord) rn
    from jsonb_array_elements(p_items) with ordinality e(elem, ord)
    cross join lateral (select case when coalesce(e.elem->>'id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then (e.elem->>'id')::uuid end as cand) c
  ) x;

  -- Los que ya no están: se borran (como antes; sus vínculos en OC/remitos quedan en null por la FK).
  delete from public.presupuesto_items pi
  where pi.presupuesto_id = p_presupuesto_id
    and not exists (select 1 from (select (j->>'ord')::int as ord, j->'elem' as elem, (j->>'item_id')::uuid as item_id from jsonb_array_elements(v_renglones) j) r where r.item_id = pi.id);

  -- Los que siguen: se actualizan en su lugar.
  update public.presupuesto_items pi
  set producto_id = item.producto_id,
      codigo = coalesce(item.codigo, ''),
      descripcion = btrim(item.descripcion),
      categoria = item.categoria,
      cantidad = item.cantidad,
      unidad = coalesce(nullif(item.unidad, ''), 'u'),
      precio_costo = coalesce(item.precio_costo, 0),
      markup_porcentaje = coalesce(item.markup_porcentaje, 0),
      precio_venta = coalesce(item.precio_venta, 0),
      iva_porcentaje = coalesce(item.iva_porcentaje, 21),
      orden = item.orden,
      proveedor_id = item.proveedor_id,
      stock_propio = coalesce(item.stock_propio, false),
      lista_item_id = item.lista_item_id,
      proveedor_nombre = item.proveedor_nombre,
      costo_moneda = coalesce(nullif(item.costo_moneda, ''), 'ARS'),
      precio_lista = case when r.elem ? 'precio_lista' then item.precio_lista else pi.precio_lista end,
      descuento_porcentaje = case when r.elem ? 'descuento_porcentaje' then coalesce(item.descuento_porcentaje, 0) else pi.descuento_porcentaje end,
      pedido_texto = case when r.elem ? 'pedido_texto' then item.pedido_texto else pi.pedido_texto end,
      catalogo_id = case when r.elem ? 'catalogo_id' then item.catalogo_id else pi.catalogo_id end,
      proveedor_sugerido_id = case when r.elem ? 'proveedor_sugerido_id' then item.proveedor_sugerido_id else pi.proveedor_sugerido_id end,
      ia_confianza = case when r.elem ? 'ia_confianza' then item.ia_confianza else pi.ia_confianza end,
      ia_nota = case when r.elem ? 'ia_nota' then item.ia_nota else pi.ia_nota end
  from (select (j->>'ord')::int as ord, j->'elem' as elem, (j->>'item_id')::uuid as item_id from jsonb_array_elements(v_renglones) j) r
  cross join lateral jsonb_populate_record(null::public.presupuesto_items, r.elem) item
  where r.item_id is not null and pi.id = r.item_id;

  -- Los nuevos: se agregan.
  insert into public.presupuesto_items (
    presupuesto_id, producto_id, codigo, descripcion, categoria, cantidad,
    unidad, precio_costo, markup_porcentaje, precio_venta, iva_porcentaje,
    orden, proveedor_id, stock_propio, lista_item_id, proveedor_nombre,
    costo_moneda, precio_lista, descuento_porcentaje, pedido_texto, catalogo_id,
    proveedor_sugerido_id, ia_confianza, ia_nota
  )
  select
    p_presupuesto_id, item.producto_id, coalesce(item.codigo, ''),
    btrim(item.descripcion), item.categoria, item.cantidad,
    coalesce(nullif(item.unidad, ''), 'u'), coalesce(item.precio_costo, 0),
    coalesce(item.markup_porcentaje, 0), coalesce(item.precio_venta, 0),
    coalesce(item.iva_porcentaje, 21), item.orden, item.proveedor_id,
    coalesce(item.stock_propio, false), item.lista_item_id,
    item.proveedor_nombre, coalesce(nullif(item.costo_moneda, ''), 'ARS'),
    item.precio_lista, coalesce(item.descuento_porcentaje, 0), item.pedido_texto, item.catalogo_id,
    item.proveedor_sugerido_id, item.ia_confianza, item.ia_nota
  from (select (j->>'ord')::int as ord, j->'elem' as elem, (j->>'item_id')::uuid as item_id from jsonb_array_elements(v_renglones) j) r
  cross join lateral jsonb_populate_record(null::public.presupuesto_items, r.elem - 'id') item
  where r.item_id is null
  order by r.ord;

  return v_id;
end;
$function$;

create or replace function public.crear_presupuesto_atomico(p_sociedad_id uuid, p_presupuesto jsonb, p_items jsonb)
 returns uuid
 language plpgsql
 set search_path to 'pg_catalog', 'public'
as $function$
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
    modalidad_emision, descuento_general_porcentaje
  ) values (
    v_new.cliente_id, v_new.vendedor_id, v_new.sucursal_id, v_new.contacto_id,
    v_new.created_by, p_sociedad_id, v_new.fecha, v_new.vencimiento,
    v_new.estado, v_new.enviado_at, v_new.markup_general, v_new.subtotal,
    v_new.iva, v_new.total, v_new.moneda, v_new.tipo_cambio,
    v_new.tipo_cambio_divisas, v_new.cotizacion_modalidad,
    v_new.observaciones, v_new.notas_internas, v_new.tipo_comprobante,
    v_new.modalidad_emision, coalesce(v_new.descuento_general_porcentaje, 0)
  ) returning id into v_id;

  insert into public.presupuesto_items (
    presupuesto_id, producto_id, codigo, descripcion, categoria, cantidad,
    unidad, precio_costo, markup_porcentaje, precio_venta, iva_porcentaje,
    orden, proveedor_id, stock_propio, lista_item_id, proveedor_nombre,
    costo_moneda, precio_lista, descuento_porcentaje, pedido_texto, catalogo_id,
    proveedor_sugerido_id, ia_confianza, ia_nota
  )
  select
    v_id, item.producto_id, coalesce(item.codigo, ''),
    btrim(item.descripcion), item.categoria, item.cantidad,
    coalesce(nullif(item.unidad, ''), 'u'), coalesce(item.precio_costo, 0),
    coalesce(item.markup_porcentaje, 0), coalesce(item.precio_venta, 0),
    coalesce(item.iva_porcentaje, 21), item.orden, item.proveedor_id,
    coalesce(item.stock_propio, false), item.lista_item_id,
    item.proveedor_nombre, coalesce(nullif(item.costo_moneda, ''), 'ARS'),
    item.precio_lista, coalesce(item.descuento_porcentaje, 0), item.pedido_texto, item.catalogo_id,
    item.proveedor_sugerido_id, item.ia_confianza, item.ia_nota
  from jsonb_populate_recordset(null::public.presupuesto_items, p_items) item;

  return v_id;
end;
$function$;

commit;
