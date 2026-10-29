-- Auditoría integral, Tanda 5 — H13 (29/10/2026, OK de Augusto): la factura común autorizada por ARCA se registra en la base
-- en UNA transacción (cabecera, renglones y PR "facturado"), igual que la nota de crédito (registrar_nota_credito_venta_autorizada).
-- Antes: el servidor insertaba la factura y después los renglones en pasos sueltos; si fallaba el guardado, la factura existía
-- en ARCA pero no en el CRM, el punto de venta quedaba trabado y el navegador igual marcaba el PR como facturado.
-- Ahora es idempotente por la clave de emisión (columna nueva facturas.emision_request_key): si se reintenta con la misma
-- clave, NO se vuelve a emitir en ARCA y la función devuelve la misma factura.
-- Aditivo: agrega una columna (vacía para las facturas viejas), un índice único parcial y una función.
-- Vuelta atrás: supabase/rollback/20261029120000_registrar_factura_venta_autorizada.sql
begin;

alter table public.facturas add column if not exists emision_request_key uuid;
comment on column public.facturas.emision_request_key is
  'Clave de emisión fiscal (Idempotency-Key) con la que se registró una factura común autorizada por ARCA. Auditoría H13.';
create unique index if not exists facturas_emision_request_key_uidx
  on public.facturas (sociedad_id, emision_request_key) where emision_request_key is not null;

create or replace function public.registrar_factura_venta_autorizada(
  p_sociedad_id uuid,
  p_request_key uuid,
  p_factura jsonb,
  p_items jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_user uuid := auth.uid();
  v_attempt public.fiscal_emission_attempts%rowtype;
  v_existente public.facturas%rowtype;
  v_id uuid;
  v_item jsonb;
  v_orden integer := 0;
  v_tipo text;
  v_fecha date;
  v_cae_vto date;
  v_punto_venta integer;
  v_numero integer;
  v_subtotal numeric;
  v_iva numeric;
  v_total numeric;
  v_tipo_cambio numeric;
  v_presupuesto_id uuid;
  v_cliente_id uuid;
  v_descripcion text;
  v_cantidad numeric;
  v_precio numeric;
  v_item_iva numeric;
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
    raise exception 'No tenés autorización para registrar facturas en esta sociedad'
      using errcode = '42501';
  end if;

  if p_sociedad_id is null or p_request_key is null
    or p_factura is null or jsonb_typeof(p_factura) <> 'object'
    or p_items is null or jsonb_typeof(p_items) <> 'array'
    or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 500
  then
    raise exception 'Faltan datos mínimos para registrar la factura' using errcode = '22023';
  end if;

  -- Tiene que existir la autorización de ARCA de este intento (la deja el servidor antes de llamar acá).
  select * into v_attempt
  from public.fiscal_emission_attempts
  where sociedad_id = p_sociedad_id and request_key = p_request_key
  for update;
  if not found or v_attempt.state not in ('authorized', 'completed') then
    raise exception 'La factura no tiene una autorización ARCA registrada' using errcode = '55000';
  end if;
  if v_attempt.user_id <> v_user then
    raise exception 'La autorización ARCA pertenece a otro usuario' using errcode = '42501';
  end if;

  begin
    v_tipo := upper(btrim(coalesce(p_factura->>'tipo', '')));
    v_fecha := (p_factura->>'fecha')::date;
    v_cae_vto := nullif(p_factura->>'cae_vencimiento', '')::date;
    v_punto_venta := (p_factura->>'punto_venta')::integer;
    v_numero := (p_factura->>'numero')::integer;
    v_subtotal := round((p_factura->>'subtotal')::numeric, 2);
    v_iva := round((p_factura->>'iva')::numeric, 2);
    v_total := round((p_factura->>'total')::numeric, 2);
    v_tipo_cambio := nullif(p_factura->>'tipo_cambio', '')::numeric;
    v_presupuesto_id := nullif(p_factura->>'presupuesto_id', '')::uuid;
    v_cliente_id := nullif(nullif(p_factura->>'cliente_id', ''), 'consumidor_final')::uuid;
  exception when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range then
    raise exception 'Los datos fiscales de la factura tienen formato inválido' using errcode = '22023';
  end;

  if v_tipo not in ('FA', 'FB', 'FCEA', 'FCEB')
    or v_punto_venta is null or v_punto_venta <= 0 or v_numero is null or v_numero <= 0
    or v_subtotal < 0 or v_iva < 0 or v_total <= 0
    or abs(v_total - round(v_subtotal + v_iva, 2)) > 0.05
    or coalesce(p_factura->>'cae', '') !~ '^[0-9]{14}$'
  then
    raise exception 'El tipo, número, CAE o los importes de la factura son inválidos' using errcode = '22023';
  end if;

  -- Idempotente: si ya se registró con esta clave (o el número fiscal ya está en el CRM), devuelve esa misma factura.
  select * into v_existente
  from public.facturas
  where sociedad_id = p_sociedad_id
    and (emision_request_key = p_request_key
         or (tipo::text = v_tipo and punto_venta = v_punto_venta and numero = v_numero))
  order by (emision_request_key = p_request_key) desc nulls last
  limit 1
  for update;
  if found then
    if v_existente.tipo::text is distinct from v_tipo
      or v_existente.punto_venta is distinct from v_punto_venta
      or v_existente.numero is distinct from v_numero
      or coalesce(v_existente.cae, '') is distinct from p_factura->>'cae'
    then
      raise exception 'La clave fiscal o el número ya están usados por otra factura' using errcode = '22023';
    end if;
    if v_existente.emision_request_key is null then
      update public.facturas set emision_request_key = p_request_key where id = v_existente.id;
    end if;
    -- Si quedó sin renglones (el guardado viejo fallaba entre la cabecera y los renglones), se completan ahora.
    if not exists (select 1 from public.factura_items where factura_id = v_existente.id) then
      for v_item in select value from jsonb_array_elements(p_items) loop
        insert into public.factura_items (factura_id, descripcion, cantidad, precio_unitario, iva_porcentaje, orden)
        values (v_existente.id, left(coalesce(nullif(btrim(v_item->>'descripcion'), ''), 'Item'), 500),
                (v_item->>'cantidad')::numeric, (v_item->>'precio_unitario')::numeric,
                coalesce(nullif(v_item->>'iva_porcentaje', '')::numeric, 21), v_orden);
        v_orden := v_orden + 1;
      end loop;
    end if;
    if v_existente.presupuesto_id is not null then
      update public.presupuestos set estado = 'facturado'
      where id = v_existente.presupuesto_id and sociedad_id = p_sociedad_id and estado::text <> 'facturado';
    end if;
    return jsonb_build_object('factura_id', v_existente.id, 'replayed', true);
  end if;

  insert into public.facturas (
    tipo, punto_venta, numero, cliente_id, presupuesto_id, fecha, cae, cae_vencimiento, subtotal, iva, total,
    moneda, tipo_cambio, cotizacion_modalidad, estado, sociedad_id, factura_origen_id, oc_cliente, oc_cliente_fecha,
    solicitado_por, observaciones, condicion_venta, fecha_vencimiento, nota_interna, emision_request_key, created_by
  ) values (
    v_tipo::public.comprobante_type, v_punto_venta, v_numero, v_cliente_id, v_presupuesto_id, v_fecha,
    p_factura->>'cae', v_cae_vto, v_subtotal, v_iva, v_total,
    case when upper(coalesce(p_factura->>'moneda', 'ARS')) = 'USD' then 'USD' else 'ARS' end,
    v_tipo_cambio, nullif(p_factura->>'cotizacion_modalidad', ''), 'emitida'::public.factura_status, p_sociedad_id,
    null, nullif(p_factura->>'oc_cliente', ''), nullif(p_factura->>'oc_cliente_fecha', '')::date,
    nullif(p_factura->>'solicitado_por', ''), nullif(p_factura->>'observaciones', ''), nullif(p_factura->>'condicion_venta', ''),
    nullif(p_factura->>'fecha_vencimiento', '')::date, nullif(p_factura->>'nota_interna', ''), p_request_key, v_user
  ) returning id into v_id;

  for v_item in select value from jsonb_array_elements(p_items) loop
    begin
      v_descripcion := left(coalesce(nullif(btrim(v_item->>'descripcion'), ''), 'Item'), 500);
      v_cantidad := (v_item->>'cantidad')::numeric;
      v_precio := (v_item->>'precio_unitario')::numeric;
      v_item_iva := coalesce(nullif(v_item->>'iva_porcentaje', '')::numeric, 21);
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'Un renglón de la factura tiene un número inválido' using errcode = '22023';
    end;
    if v_cantidad is null or v_cantidad <= 0 or v_precio is null or v_precio < 0 then
      raise exception 'Cada renglón necesita cantidad mayor que cero y precio válido' using errcode = '22023';
    end if;
    insert into public.factura_items (factura_id, descripcion, cantidad, precio_unitario, iva_porcentaje, orden)
    values (v_id, v_descripcion, v_cantidad, v_precio, v_item_iva, v_orden);
    v_orden := v_orden + 1;
  end loop;

  -- El PR pasa a "facturado" en la misma transacción (antes lo hacía el navegador aunque la factura no se hubiera guardado).
  if v_presupuesto_id is not null then
    update public.presupuestos set estado = 'facturado'
    where id = v_presupuesto_id and sociedad_id = p_sociedad_id and estado::text <> 'facturado';
  end if;

  return jsonb_build_object('factura_id', v_id, 'replayed', false);
end;
$$;

revoke all on function public.registrar_factura_venta_autorizada(uuid, uuid, jsonb, jsonb) from public, anon;
grant execute on function public.registrar_factura_venta_autorizada(uuid, uuid, jsonb, jsonb) to authenticated;
comment on function public.registrar_factura_venta_autorizada(uuid, uuid, jsonb, jsonb) is
  'Auditoría H13: registra la factura común autorizada por ARCA (cabecera, renglones y PR facturado) en una transacción, idempotente por la clave de emisión.';

commit;
