-- Vuelta atrás de 20261102120000_nc_venta_a_favor_aplicable.sql: vuelve la función a como quedó en 20261008120000.
-- No borra los saldos a favor (ajustes crédito "Saldo a favor de la NC…") que se hayan creado mientras estuvo vigente:
-- son plata del cliente y pueden estar aplicados. Si hiciera falta, se anulan a mano desde Finanzas.
begin;

create or replace function public.registrar_nota_credito_venta_autorizada(
  p_sociedad_id uuid,
  p_request_key uuid,
  p_factura_origen_id uuid,
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
  v_origen public.facturas%rowtype;
  v_existente public.facturas%rowtype;
  v_nc_id uuid;
  v_item jsonb;
  v_tipo text;
  v_modo text;
  v_fecha date;
  v_punto_venta integer;
  v_numero integer;
  v_subtotal numeric;
  v_iva numeric;
  v_total numeric;
  v_tipo_cambio numeric;
  v_pagado numeric := 0;
  v_saldo_antes numeric;
  v_aplicado numeric;
  v_saldo_favor numeric;
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
    raise exception 'No tenés autorización para registrar notas de crédito en esta sociedad'
      using errcode = '42501';
  end if;

  if p_sociedad_id is null or p_request_key is null or p_factura_origen_id is null
    or p_factura is null or jsonb_typeof(p_factura) <> 'object'
    or p_items is null or jsonb_typeof(p_items) <> 'array'
    or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 500
  then
    raise exception 'Faltan datos mínimos para registrar la nota de crédito'
      using errcode = '22023';
  end if;

  select * into v_attempt
  from public.fiscal_emission_attempts
  where sociedad_id = p_sociedad_id and request_key = p_request_key
  for update;
  if not found or v_attempt.state not in ('authorized', 'completed') then
    raise exception 'La nota de crédito no tiene una autorización ARCA registrada'
      using errcode = '55000';
  end if;
  if v_attempt.user_id <> v_user then
    raise exception 'La autorización ARCA pertenece a otro usuario' using errcode = '42501';
  end if;
  if v_attempt.request_payload->>'factura_origen_id' is distinct from p_factura_origen_id::text then
    raise exception 'La factura origen no coincide con la autorización ARCA' using errcode = '22023';
  end if;

  begin
    v_tipo := upper(btrim(coalesce(p_factura->>'tipo', '')));
    v_modo := lower(btrim(coalesce(p_factura->>'nota_credito_modo', 'items')));
    v_fecha := (p_factura->>'fecha')::date;
    v_punto_venta := (p_factura->>'punto_venta')::integer;
    v_numero := (p_factura->>'numero')::integer;
    v_subtotal := round((p_factura->>'subtotal')::numeric, 2);
    v_iva := round((p_factura->>'iva')::numeric, 2);
    v_total := round((p_factura->>'total')::numeric, 2);
    v_tipo_cambio := nullif(p_factura->>'tipo_cambio', '')::numeric;
  exception when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range then
    raise exception 'Los datos fiscales de la nota de crédito tienen formato inválido'
      using errcode = '22023';
  end;

  if v_tipo not in ('NCA', 'NCB', 'NCEA', 'NCEB')
    or v_modo not in ('total', 'items', 'amount')
    or v_punto_venta <= 0 or v_numero <= 0
    or v_subtotal < 0 or v_iva < 0 or v_total <= 0
    or abs(v_total - round(v_subtotal + v_iva, 2)) > 0.01
    or coalesce(p_factura->>'cae', '') !~ '^[0-9]{14}$'
  then
    raise exception 'El tipo, número, CAE o los importes de la nota de crédito son inválidos'
      using errcode = '22023';
  end if;

  select * into v_existente
  from public.facturas
  where sociedad_id = p_sociedad_id and nota_credito_request_key = p_request_key
  for update;
  if found then
    if v_existente.factura_origen_id is distinct from p_factura_origen_id
      or v_existente.tipo::text is distinct from v_tipo
      or v_existente.numero is distinct from v_numero
      or v_existente.cae is distinct from p_factura->>'cae'
      or v_existente.total is distinct from v_total
    then
      raise exception 'La clave fiscal ya fue usada con otra nota de crédito'
        using errcode = '22023';
    end if;
    return jsonb_build_object(
      'factura_id', v_existente.id,
      'factura_origen_id', v_existente.factura_origen_id,
      'credito_aplicado', v_existente.credito_aplicado,
      'saldo_a_favor', v_existente.saldo_a_favor_cliente,
      'saldo_restante', greatest(0, coalesce((
        select round(f.total - coalesce(f.total_acreditado, 0), 2)
        from public.facturas f
        where f.id = v_existente.factura_origen_id
      ), 0)),
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
  if v_origen.cliente_id::text is distinct from p_factura->>'cliente_id'
    or v_origen.moneda::text is distinct from p_factura->>'moneda'
    or v_origen.tipo::text not in ('FA', 'FB', 'FCEA', 'FCEB')
    or (v_tipo = 'NCA' and v_origen.tipo::text <> 'FA')
    or (v_tipo = 'NCB' and v_origen.tipo::text <> 'FB')
    or (v_tipo = 'NCEA' and v_origen.tipo::text <> 'FCEA')
    or (v_tipo = 'NCEB' and v_origen.tipo::text <> 'FCEB')
  then
    raise exception 'La nota debe corresponder a la misma sociedad, cliente, moneda y tipo de la factura original'
      using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    begin
      v_descripcion := btrim(coalesce(v_item->>'descripcion', ''));
      v_cantidad := (v_item->>'cantidad')::numeric;
      v_precio := (v_item->>'precio_unitario')::numeric;
      v_item_iva := (v_item->>'iva_porcentaje')::numeric;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'Un ítem de la nota tiene un número inválido' using errcode = '22023';
    end;
    if v_descripcion = '' or v_cantidad <= 0 or v_precio < 0
      or v_item_iva < 0 or v_item_iva > 100
    then
      raise exception 'Cada ítem necesita descripción, cantidad y precio válidos'
        using errcode = '22023';
    end if;
  end loop;

  select coalesce(sum(m.monto), 0) into v_pagado
  from public.movimientos m
  where m.factura_id = v_origen.id
    and m.sociedad_id = p_sociedad_id
    and not coalesce(m.anulado, false);
  v_pagado := v_pagado + coalesce((
    select sum(a.monto)
    from public.cobro_aplicaciones a
    join public.movimientos m on m.id = a.movimiento_id
    where a.factura_id = v_origen.id
      and m.sociedad_id = p_sociedad_id
      and not coalesce(m.anulado, false)
  ), 0);

  v_saldo_antes := greatest(0, round(v_origen.total - coalesce(v_origen.total_acreditado, 0) - v_pagado, 2));
  v_aplicado := least(v_total, v_saldo_antes);
  v_saldo_favor := greatest(0, round(v_total - v_aplicado, 2));

  insert into public.facturas (
    tipo, punto_venta, numero, cliente_id, presupuesto_id, fecha, cae,
    cae_vencimiento, subtotal, iva, total, moneda, tipo_cambio,
    cotizacion_modalidad, estado, sociedad_id, observaciones, nota_interna,
    factura_origen_id, nota_credito_request_key, nota_credito_modo,
    credito_aplicado, saldo_a_favor_cliente, created_by
  ) values (
    v_tipo::public.comprobante_type, v_punto_venta, v_numero, v_origen.cliente_id,
    v_origen.presupuesto_id, v_fecha, p_factura->>'cae',
    nullif(p_factura->>'cae_vencimiento', '')::date, v_subtotal, v_iva, v_total,
    v_origen.moneda, v_tipo_cambio,
    v_origen.cotizacion_modalidad, 'emitida'::public.factura_status,
    p_sociedad_id, nullif(p_factura->>'observaciones', ''),
    nullif(p_factura->>'nota_interna', ''), v_origen.id, p_request_key, v_modo,
    v_aplicado, v_saldo_favor, v_user
  ) returning id into v_nc_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    insert into public.factura_items (
      factura_id, descripcion, cantidad, precio_unitario, iva_porcentaje, orden
    ) values (
      v_nc_id, btrim(v_item->>'descripcion'), (v_item->>'cantidad')::numeric,
      (v_item->>'precio_unitario')::numeric, (v_item->>'iva_porcentaje')::numeric,
      coalesce((v_item->>'orden')::integer, 0)
    );
  end loop;

  update public.facturas
  set total_acreditado = round(coalesce(total_acreditado, 0) + v_aplicado, 2),
      estado = case
        when v_saldo_antes - v_aplicado <= 0.005 and v_modo = 'total'
          then 'anulada'::public.factura_status
        when v_saldo_antes - v_aplicado <= 0.005
          then 'pagada'::public.factura_status
        when v_aplicado > 0 then 'parcial'::public.factura_status
        else estado
      end
  where id = v_origen.id and sociedad_id = p_sociedad_id;

  if v_modo = 'total' and v_saldo_antes - v_aplicado <= 0.005
    and v_origen.presupuesto_id is not null
  then
    update public.presupuestos
    set estado = 'facturar'
    where id = v_origen.presupuesto_id and sociedad_id = p_sociedad_id;
  end if;

  return jsonb_build_object(
    'factura_id', v_nc_id,
    'factura_origen_id', v_origen.id,
    'credito_aplicado', v_aplicado,
    'saldo_a_favor', v_saldo_favor,
    'saldo_restante', greatest(0, round(v_saldo_antes - v_aplicado, 2)),
    'replayed', false
  );
end;
$$;

revoke all on function public.registrar_nota_credito_venta_autorizada(uuid,uuid,uuid,jsonb,jsonb)
  from public, anon;
grant execute on function public.registrar_nota_credito_venta_autorizada(uuid,uuid,uuid,jsonb,jsonb)
  to authenticated;

comment on function public.registrar_nota_credito_venta_autorizada(uuid,uuid,uuid,jsonb,jsonb) is
  'Finaliza localmente una NC ya autorizada por ARCA sin posibilidad de duplicar el comprobante.';

commit;
