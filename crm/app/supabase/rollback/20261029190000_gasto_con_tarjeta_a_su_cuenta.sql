-- Vuelta atrás de 20261029190000_gasto_con_tarjeta_a_su_cuenta.sql: crear_gasto_con_pago vuelve a ser la de
-- 20261029100000_gastos_alta_baja_atomicas.sql (el pago sin cuenta: la base le sugiere la del banco).
begin;

create or replace function public.crear_gasto_con_pago(p_sociedad_id uuid, p_gasto jsonb, p_descripcion_pago text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_monto numeric;
  v_moneda text;
  v_fecha date;
  v_descripcion text;
begin
  if auth.uid() is null then
    raise exception 'Sesión no válida';
  end if;
  if not public.lz_puede_operar_finanzas(p_sociedad_id) then
    raise exception 'No tenés permiso para cargar gastos en esta sociedad' using errcode = '42501';
  end if;
  if p_gasto is null or jsonb_typeof(p_gasto) <> 'object' then
    raise exception 'Faltan los datos del gasto' using errcode = '22023';
  end if;

  begin
    v_monto := round((p_gasto->>'monto')::numeric, 2);
    v_fecha := (p_gasto->>'fecha')::date;
  exception when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range then
    raise exception 'El monto o la fecha del gasto tienen formato inválido' using errcode = '22023';
  end;
  v_moneda := case when upper(coalesce(p_gasto->>'moneda', 'ARS')) = 'USD' then 'USD' else 'ARS' end;
  v_descripcion := btrim(coalesce(p_gasto->>'descripcion', ''));
  if v_descripcion = '' then
    raise exception 'Poné el detalle del gasto' using errcode = '22023';
  end if;
  if v_monto is null or v_monto <= 0 then
    raise exception 'El monto tiene que ser mayor a 0' using errcode = '22023';
  end if;
  if v_fecha is null then
    raise exception 'Falta la fecha del gasto' using errcode = '22023';
  end if;

  insert into public.gastos_manuales (
    sociedad_id, fecha, descripcion, categoria, grupo, monto, moneda, medio_pago, tipo_recurrencia, tipo_gasto,
    notas, gasto_fijo_id, comprobante_url, proveedor_id, created_by
  ) values (
    p_sociedad_id, v_fecha, v_descripcion,
    nullif(p_gasto->>'categoria', ''), nullif(p_gasto->>'grupo', ''), v_monto, v_moneda,
    coalesce(nullif(p_gasto->>'medio_pago', ''), 'transferencia'),
    nullif(p_gasto->>'tipo_recurrencia', ''), coalesce(nullif(p_gasto->>'tipo_gasto', ''), 'general'),
    coalesce(p_gasto->>'notas', ''), nullif(p_gasto->>'gasto_fijo_id', '')::uuid,
    nullif(p_gasto->>'comprobante_url', ''), nullif(p_gasto->>'proveedor_id', '')::uuid, auth.uid()
  ) returning id into v_id;

  insert into public.movimientos (tipo, descripcion, monto, moneda, fecha, conciliado, gasto_manual_id, sociedad_id, created_by)
  values ('pago'::public.movimiento_tipo, left(coalesce(nullif(btrim(p_descripcion_pago), ''), 'Gasto — ' || v_descripcion), 500), v_monto, v_moneda::public.moneda_type, v_fecha, false, v_id, p_sociedad_id, auth.uid());

  return v_id;
end;
$$;

commit;
