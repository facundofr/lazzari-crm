-- Auditoría integral, Tanda 5 — H11 (29/10/2026, OK de Augusto): "Guardar" de la OC en Compras Lazza en UNA transacción.
-- Antes el navegador hacía 6 pasos sueltos (sacar renglones, cambiar los que quedan, agregar nuevos, encabezado,
-- pasar artículos a otro proveedor y actualizar el PR); si se cortaba a mitad la OC quedaba a medias y el PR con otro costo.
-- Ahora guardar_oc_lazza hace todo junto: si algo falla (también el PR) no se guarda nada.
--  * Lo que se cambia lo arma la pantalla (como hoy); la base lo aplica todo junto y calcula el estado con lo que
--    llegó según la base en ese momento (si alguien marcó "Llegó" mientras tanto, no se pisa).
--  * Antes de guardar avisa (no traba): si alguien cambió la OC mientras estaba abierta, o si un artículo que se saca
--    está atado a una factura o a un ajuste (al sacarlo se pierde ese vínculo; la factura no cambia). Con esos avisos
--    devuelve {confirmar: [...]} sin guardar nada; la pantalla pregunta y vuelve a llamar con p_confirmado = true.
--  * Artículos a otro proveedor: igual que asignarRenglonesAProveedor (lib/oc-sin-proveedor.ts): van a una OC sin pedir
--    de ese proveedor del mismo PR y moneda, o a una OC nueva; la OC que queda vacía se cancela (no se borra).
--  * SECURITY INVOKER: los permisos son los mismos de hoy (las reglas de cada tabla).
-- Aditivo: solo agrega una función. Vuelta atrás: supabase/rollback/20261029171000_guardar_oc_lazza.sql
begin;

create or replace function public.guardar_oc_lazza(p_oc_id uuid, p_sociedad_id uuid, p_datos jsonb, p_confirmado boolean default false)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_oc record;
  v_confirmar jsonb := '[]'::jsonb;
  v_avisos jsonb := '[]'::jsonb;
  v_destinos jsonb := '[]'::jsonb;
  v_sacar uuid[];
  v_mueven uuid[];
  v_ids uuid[];
  v_c jsonb;
  v_n jsonb;
  v_g jsonb;
  v_e jsonb;
  v_dest uuid;
  v_dest_num text;
  v_txt text;
  v_distintos integer;
  v_total integer;
  v_completos integer;
  v_algo integer;
  v_estado text;
  v_obs text;
begin
  if auth.uid() is null then
    raise exception 'Sesión no válida';
  end if;
  if p_datos is null or jsonb_typeof(p_datos) <> 'object' then
    raise exception 'Faltan los datos de la OC' using errcode = '22023';
  end if;

  select * into v_oc from public.ordenes_compra where id = p_oc_id and sociedad_id = p_sociedad_id for update;
  if not found then
    raise exception 'No se encontró la OC' using errcode = 'P0002';
  end if;

  v_sacar := coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(p_datos->'sacar', '[]'::jsonb)) x), '{}');
  v_mueven := coalesce((select array_agg(x::uuid) from jsonb_array_elements(coalesce(p_datos->'mover', '[]'::jsonb)) g,
                        jsonb_array_elements_text(coalesce(g->'item_ids', '[]'::jsonb)) x), '{}');

  -- 0. Avisos antes de guardar (nunca traban: con p_confirmado se guarda igual).
  if not p_confirmado then
    if nullif(p_datos#>>'{antes,updated_at}', '') is not null and v_oc.updated_at is distinct from (p_datos#>>'{antes,updated_at}')::timestamptz then
      v_confirmar := v_confirmar || to_jsonb(format('Mientras tenías abierta %s, alguien guardó cambios en la OC. Si guardás, quedan los tuyos.', v_oc.numero));
    else
      select count(*) into v_distintos
      from (select i.id, i.codigo, i.descripcion, i.cantidad, i.precio_unitario from public.orden_compra_items i where i.orden_id = p_oc_id) actual
      full join (select (a->>'id')::uuid id, a->>'codigo' codigo, a->>'descripcion' descripcion, (a->>'cantidad')::numeric cantidad, (a->>'precio_unitario')::numeric precio_unitario
                 from jsonb_array_elements(coalesce(p_datos#>'{antes,items}', '[]'::jsonb)) a) antes using (id)
      where actual.codigo is distinct from antes.codigo or actual.descripcion is distinct from antes.descripcion
         or actual.cantidad is distinct from antes.cantidad or actual.precio_unitario is distinct from antes.precio_unitario;
      if p_datos#>'{antes,items}' is not null and v_distintos > 0 then
        v_confirmar := v_confirmar || to_jsonb(format('Mientras tenías abierta %s, alguien cambió %s artículo(s). Si guardás, quedan los tuyos.', v_oc.numero, v_distintos));
      end if;
    end if;
    for v_txt in
      select format('«%s» está atado a una factura o ajuste: si lo sacás de la OC se pierde ese vínculo (la factura no cambia).', i.descripcion)
      from public.orden_compra_items i
      where i.id = any(v_sacar) and i.orden_id = p_oc_id
        and (exists (select 1 from public.factura_compra_asignaciones a where a.orden_compra_item_id = i.id)
             or exists (select 1 from public.lz_oc_ajustes j where j.oc_item_id = i.id))
    loop
      v_confirmar := v_confirmar || to_jsonb(v_txt);
    end loop;
    if jsonb_array_length(v_confirmar) > 0 then
      return jsonb_build_object('confirmar', v_confirmar);
    end if;
  end if;

  -- 1. Sacar renglones
  delete from public.orden_compra_items where id = any(v_sacar) and orden_id = p_oc_id;

  -- 2. Cambios en los que quedan (y en los que se van, antes de moverlos). Solo se cambia lo que viene.
  for v_c in select * from jsonb_array_elements(coalesce(p_datos->'cambios', '[]'::jsonb)) loop
    update public.orden_compra_items set
      codigo = case when v_c ? 'codigo' then coalesce(v_c->>'codigo', '') else codigo end,
      descripcion = case when v_c ? 'descripcion' then coalesce(v_c->>'descripcion', '') else descripcion end,
      cantidad = case when v_c ? 'cantidad' then (v_c->>'cantidad')::numeric else cantidad end,
      precio_unitario = case when v_c ? 'precio_unitario' then (v_c->>'precio_unitario')::numeric else precio_unitario end,
      moneda = case when v_c ? 'moneda' then v_c->>'moneda' else moneda end,
      proveedor_id = case when v_c ? 'proveedor_id' then nullif(v_c->>'proveedor_id', '')::uuid else proveedor_id end
    where id = (v_c->>'id')::uuid and orden_id = p_oc_id;
    if not found then
      raise exception 'Un artículo ya no está en %: volvé a abrirla', v_oc.numero using errcode = 'P0002';
    end if;
  end loop;

  -- 3. Renglones nuevos
  for v_n in select * from jsonb_array_elements(coalesce(p_datos->'nuevos', '[]'::jsonb)) loop
    insert into public.orden_compra_items (orden_id, codigo, descripcion, cantidad, cantidad_recibida, unidad, precio_unitario, iva_porcentaje, orden, proveedor_id, moneda)
    values (p_oc_id, coalesce(v_n->>'codigo', ''), coalesce(v_n->>'descripcion', ''), coalesce((v_n->>'cantidad')::numeric, 0), 0, 'u',
            coalesce((v_n->>'precio_unitario')::numeric, 0), coalesce((v_n->>'iva_porcentaje')::numeric, 21), coalesce((v_n->>'orden')::integer, 0),
            nullif(v_n->>'proveedor_id', '')::uuid, nullif(v_n->>'moneda', ''));
  end loop;

  -- 4. Encabezado. El estado sale de lo que llegó según la base (sin los artículos que se van); si no queda ninguno, no cambia.
  select count(*), count(*) filter (where coalesce(cantidad_recibida, 0) >= cantidad), count(*) filter (where coalesce(cantidad_recibida, 0) > 0)
    into v_total, v_completos, v_algo
  from public.orden_compra_items where orden_id = p_oc_id and not (id = any(v_mueven));
  v_estado := v_oc.estado::text;
  if v_total > 0 and v_oc.estado::text <> 'cancelada' then
    if v_completos = v_total then v_estado := 'recibida';
    elsif v_algo > 0 then v_estado := 'recibida_parcial';
    elsif v_oc.estado::text in ('recibida', 'recibida_parcial') then v_estado := 'enviada';
    end if;
  end if;
  v_e := coalesce(p_datos->'encabezado', '{}'::jsonb);
  update public.ordenes_compra set
    proveedor_id = case when v_e ? 'proveedor_id' then nullif(v_e->>'proveedor_id', '')::uuid else proveedor_id end,
    subtotal = coalesce((v_e->>'subtotal')::numeric, subtotal),
    iva = coalesce((v_e->>'iva')::numeric, iva),
    total = coalesce((v_e->>'total')::numeric, total),
    estado = v_estado::public.oc_status,
    fecha_entrega_estimada = case when v_e ? 'fecha_entrega_estimada' then nullif(v_e->>'fecha_entrega_estimada', '')::date else fecha_entrega_estimada end,
    observaciones = case when v_e ? 'observaciones' then coalesce(v_e->>'observaciones', '') else observaciones end,
    created_by = case when v_e ? 'created_by' then nullif(v_e->>'created_by', '')::uuid else created_by end
  where id = p_oc_id;

  -- 5. Artículos a otro proveedor: a una OC sin pedir de ese proveedor del mismo PR y moneda, o a una nueva. La vacía se cancela.
  for v_g in select * from jsonb_array_elements(coalesce(p_datos->'mover', '[]'::jsonb)) loop
    v_ids := coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(v_g->'item_ids', '[]'::jsonb)) x), '{}');
    continue when cardinality(v_ids) = 0;
    select id, numero into v_dest, v_dest_num from public.ordenes_compra
    where sociedad_id = p_sociedad_id and proveedor_id = (v_g->>'proveedor_id')::uuid and moneda = v_oc.moneda
      and estado <> 'cancelada' and id <> p_oc_id and presupuesto_origen_id is not distinct from v_oc.presupuesto_origen_id and pedido = false
    order by fecha, created_at limit 1;
    if v_dest is null then
      insert into public.ordenes_compra (proveedor_id, presupuesto_origen_id, sociedad_id, fecha, moneda, estado, subtotal, iva, total, observaciones, created_by)
      values ((v_g->>'proveedor_id')::uuid, v_oc.presupuesto_origen_id, p_sociedad_id, (now() at time zone 'America/Argentina/Buenos_Aires')::date,
              v_oc.moneda, 'enviada', 0, 0, 0,
              format('Proveedor real %s: renglones pasados desde %s %s', coalesce(v_g->>'proveedor_nombre', ''), v_oc.numero, coalesce(nullif(p_datos->>'motivo', ''), 'al cambiarles el proveedor en la OC')),
              auth.uid())
      returning id, numero into v_dest, v_dest_num;
    end if;
    update public.orden_compra_items set orden_id = v_dest where id = any(v_ids) and orden_id = p_oc_id;
    if not (v_destinos @> to_jsonb(array[v_dest_num])) then v_destinos := v_destinos || to_jsonb(v_dest_num); end if;
    if not exists (select 1 from public.orden_compra_items where orden_id = p_oc_id) then
      select observaciones into v_obs from public.ordenes_compra where id = p_oc_id;
      update public.ordenes_compra set estado = 'cancelada',
        observaciones = regexp_replace(format('%s · Vacía: sus renglones pasaron a %s', coalesce(v_obs, ''), coalesce(v_g->>'proveedor_nombre', '')), '^ · ', '')
      where id = p_oc_id;
    end if;
    if v_oc.pedido and not (v_avisos @> to_jsonb(array[format('%s ya figuraba como pedida: revisá con el proveedor anterior', v_oc.numero)])) then
      v_avisos := v_avisos || to_jsonb(format('%s ya figuraba como pedida: revisá con el proveedor anterior', v_oc.numero));
    end if;
    v_dest := null; v_dest_num := null;
  end loop;

  -- 6. PR de origen: proveedor y costo con su moneda (solo renglones de ese PR). Si falla, no se guarda nada.
  if v_oc.presupuesto_origen_id is not null then
    for v_g in select * from jsonb_array_elements(coalesce(p_datos#>'{pr,proveedores}', '[]'::jsonb)) loop
      update public.presupuesto_items set proveedor_id = nullif(v_g->>'proveedor_id', '')::uuid, proveedor_nombre = coalesce(v_g->>'proveedor_nombre', '')
      where presupuesto_id = v_oc.presupuesto_origen_id
        and id = any(coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(v_g->'ids', '[]'::jsonb)) x), '{}'));
    end loop;
    for v_c in select * from jsonb_array_elements(coalesce(p_datos#>'{pr,costos}', '[]'::jsonb)) loop
      update public.presupuesto_items set precio_costo = (v_c->>'precio_costo')::numeric, costo_moneda = coalesce(nullif(v_c->>'costo_moneda', ''), 'ARS')
      where presupuesto_id = v_oc.presupuesto_origen_id and id = (v_c->>'id')::uuid;
    end loop;
  end if;

  return jsonb_build_object('ok', true, 'numero', v_oc.numero, 'destinos', v_destinos, 'avisos', v_avisos);
end;
$$;

grant execute on function public.guardar_oc_lazza(uuid, uuid, jsonb, boolean) to authenticated;

commit;
