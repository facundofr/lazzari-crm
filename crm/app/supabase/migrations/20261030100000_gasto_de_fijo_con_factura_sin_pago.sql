-- Auditoría de la plata (30/10/2026, Tanda A punto 5, D4): gasto de un fijo que ya tiene su factura del proveedor → sin pago propio.
-- Pasó con los honorarios del contador en octubre: la factura se pagó con OP y el gasto fijo creó OTRO pago (dos salidas para una
-- sola transferencia). Ahora, con medio "factura_proveedor" ("Factura (se paga con OP)"), se guarda el gasto (cuenta en el
-- resultado) pero NO su pago: el pago es la OP de la factura, desde Pagar. Cualquier otro medio, igual que antes.
-- Misma firma. Vuelta atrás: supabase/rollback/20261030100000_gasto_de_fijo_con_factura_sin_pago.sql (vuelve a la versión 20261029190000).
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
  v_medio text;
  v_cuenta uuid;
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
  v_medio := coalesce(nullif(p_gasto->>'medio_pago', ''), 'transferencia');

  -- Pagado con una tarjeta: el pago va a la cuenta de esa tarjeta (no al banco).
  if v_medio ~ '^tarjeta_[a-z]+_[0-9]{4}$' then
    select c.id into v_cuenta
      from public.cuentas_financieras c
     where c.sociedad_id = p_sociedad_id
       and c.tipo = 'tarjeta_credito'
       and coalesce(c.activa, true)
       and c.nombre ~ (right(v_medio, 4) || '\s*$')
     order by c.orden nulls last, c.created_at
     limit 1;
  end if;

  insert into public.gastos_manuales (
    sociedad_id, fecha, descripcion, categoria, grupo, monto, moneda, medio_pago, tipo_recurrencia, tipo_gasto,
    notas, gasto_fijo_id, comprobante_url, proveedor_id, created_by
  ) values (
    p_sociedad_id, v_fecha, v_descripcion,
    nullif(p_gasto->>'categoria', ''), nullif(p_gasto->>'grupo', ''), v_monto, v_moneda,
    v_medio,
    nullif(p_gasto->>'tipo_recurrencia', ''), coalesce(nullif(p_gasto->>'tipo_gasto', ''), 'general'),
    coalesce(p_gasto->>'notas', ''), nullif(p_gasto->>'gasto_fijo_id', '')::uuid,
    nullif(p_gasto->>'comprobante_url', ''), nullif(p_gasto->>'proveedor_id', '')::uuid, auth.uid()
  ) returning id into v_id;

  -- La factura del proveedor se paga con OP: el gasto queda sin pago propio (si no, son dos pagos).
  if v_medio = 'factura_proveedor' then
    return v_id;
  end if;

  -- cuenta_id nulo = como antes: la base sugiere la cuenta (movimientos_cuenta_sugerida).
  insert into public.movimientos (tipo, descripcion, monto, moneda, fecha, conciliado, gasto_manual_id, sociedad_id, cuenta_id, created_by)
  values ('pago'::public.movimiento_tipo, left(coalesce(nullif(btrim(p_descripcion_pago), ''), 'Gasto — ' || v_descripcion), 500), v_monto, v_moneda::public.moneda_type, v_fecha, false, v_id, p_sociedad_id, v_cuenta, auth.uid());

  return v_id;
end;
$$;

commit;
