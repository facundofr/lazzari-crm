-- Auditoría de la plata (30/10/2026, Tanda A punto 6): el saldo a favor del cliente y el cobro en UNA sola operación.
-- Antes Cobrar hacía dos pasos desde el navegador: primero aplicar_saldo_favor_cliente y después el cobro. Si el cobro fallaba,
-- el saldo a favor quedaba aplicado sin cobro. Ahora, si algo falla, no se guarda nada.
-- SOLO AGREGA una función que llama a las de siempre (aplicar_saldo_favor_cliente y registrar_cobro_masivo_seguro, o
-- registrar_cobro_masivo_diferencia_cc si la diferencia pasa a la cuenta corriente). No cambia tablas, datos ni otras funciones.
-- Repetición del mismo pedido (doble clic o reintento después de guardar, misma request_key): el saldo a favor no se vuelve a
-- aplicar y se devuelve el cobro ya guardado.
-- Vuelta atrás: supabase/rollback/20261030120000_cobro_y_saldo_favor_juntos.sql (saca la función; Cobrar vuelve a los dos pasos).
begin;

create or replace function public.registrar_cobro_con_saldo_favor(
  p_cliente_id uuid,
  p_facturas jsonb,
  p_medios jsonb,
  p_retenciones jsonb,
  p_fecha date,
  p_sociedad_id uuid,
  p_request_key uuid,
  p_aplicaciones jsonb,
  p_diferencia numeric default null,
  p_descripcion text default null
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_sf jsonb;
  v_result jsonb;
begin
  if p_request_key is null or p_sociedad_id is null then
    raise exception 'Solicitud de cobro masivo incompleta';
  end if;

  -- El mismo candado que el cobro: un doble clic espera al primero.
  perform pg_advisory_xact_lock(hashtextextended(p_sociedad_id::text || p_request_key::text, 0));

  -- Solo la primera vez se aplica el saldo a favor (los permisos y los saldos los controla aplicar_saldo_favor_cliente).
  if not exists (select 1 from public.cobro_solicitudes s where s.sociedad_id = p_sociedad_id and s.request_key = p_request_key)
    and jsonb_typeof(p_aplicaciones) = 'array' and jsonb_array_length(p_aplicaciones) > 0 then
    v_sf := public.aplicar_saldo_favor_cliente(p_sociedad_id, p_cliente_id, p_aplicaciones);
  end if;

  -- El cobro de siempre: ve el saldo de cada factura ya con el saldo a favor aplicado.
  if coalesce(p_diferencia, 0) > 0 then
    v_result := public.registrar_cobro_masivo_diferencia_cc(
      p_cliente_id, p_facturas, p_medios, p_retenciones, p_fecha, p_sociedad_id, p_request_key, p_diferencia, p_descripcion);
  else
    v_result := public.registrar_cobro_masivo_seguro(
      p_cliente_id, p_facturas, p_medios, p_retenciones, p_fecha, p_sociedad_id, p_request_key);
  end if;

  if v_sf is not null then
    v_result := v_result || jsonb_build_object('saldo_favor', v_sf);
    update public.cobro_solicitudes
    set resultado = v_result
    where sociedad_id = p_sociedad_id
      and request_key = p_request_key;
  end if;

  return v_result;
end;
$function$;

revoke all on function public.registrar_cobro_con_saldo_favor(uuid, jsonb, jsonb, jsonb, date, uuid, uuid, jsonb, numeric, text) from public, anon;
grant execute on function public.registrar_cobro_con_saldo_favor(uuid, jsonb, jsonb, jsonb, date, uuid, uuid, jsonb, numeric, text) to authenticated;

commit;
