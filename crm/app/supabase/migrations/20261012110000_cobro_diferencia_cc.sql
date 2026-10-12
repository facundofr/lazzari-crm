-- Cobro masivo con faltante → "Diferencia a la cuenta corriente" (pedido de Augusto, 12/10/2026).
-- Las facturas quedan PAGADAS y lo que falta queda como deuda suelta del cliente en su cuenta corriente
-- (ajuste débito, sin factura). Todo en una sola transacción: si algo falla, no se guarda nada.
--
-- Cómo: llama a registrar_cobro_masivo_seguro (la de siempre) agregando a las retenciones un renglón
-- "ajuste" por la diferencia (cierra las facturas; no es plata) y después graba el ajuste débito
-- (ajuste_sentido = 'debito') que deja la deuda en la cuenta corriente.
--
-- Aditiva: solo una función nueva. No cambia ninguna tabla ni función existente.
-- Vuelta atrás: supabase/rollback/20261012110000_cobro_diferencia_cc.sql
begin;

create or replace function public.registrar_cobro_masivo_diferencia_cc(
  p_cliente_id uuid,
  p_facturas jsonb,
  p_medios jsonb,
  p_retenciones jsonb,
  p_fecha date,
  p_sociedad_id uuid,
  p_request_key uuid,
  p_diferencia numeric,
  p_descripcion text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
  v_moneda text;
  v_desc text;
  v_ajuste_id uuid;
begin
  if p_diferencia is null or p_diferencia <= 0 then
    raise exception 'La diferencia a pasar a la cuenta corriente tiene que ser mayor a cero';
  end if;
  if jsonb_typeof(p_retenciones) is distinct from 'array' then
    raise exception 'Solicitud de cobro masivo incompleta';
  end if;

  v_desc := coalesce(nullif(trim(p_descripcion), ''), 'Diferencia de cobro pasada a la cuenta corriente');

  -- 1) Cobro de siempre (permisos, idempotencia, cheques y aplicaciones), con la diferencia como "ajuste"
  --    para que las facturas queden canceladas.
  v_result := public.registrar_cobro_masivo_seguro(
    p_cliente_id,
    p_facturas,
    p_medios,
    p_retenciones || jsonb_build_array(jsonb_build_object(
      'tipo', 'ajuste',
      'monto', round(p_diferencia, 2),
      'descripcion', v_desc || ' (cierra las facturas)'
    )),
    p_fecha,
    p_sociedad_id,
    p_request_key
  );

  -- Repetición del mismo pedido (doble clic): el ajuste ya se grabó la primera vez.
  if coalesce((v_result->>'replayed')::boolean, false) then
    return v_result;
  end if;

  select f.moneda::text into v_moneda
  from public.facturas f
  where f.id = (p_facturas->0->>'id')::uuid
    and f.sociedad_id = p_sociedad_id;

  -- 2) La deuda queda en la cuenta corriente del cliente (sin factura).
  insert into public.movimientos (
    tipo, cliente_id, factura_id, descripcion, monto, moneda, fecha, conciliado, created_by, sociedad_id, ajuste_sentido
  ) values (
    'ajuste', p_cliente_id, null, v_desc, round(p_diferencia, 2), coalesce(v_moneda, 'ARS')::moneda_type,
    p_fecha, false, auth.uid(), p_sociedad_id, 'debito'
  )
  returning id into v_ajuste_id;

  v_result := v_result || jsonb_build_object('ajuste_cc_id', v_ajuste_id, 'diferencia_cc', round(p_diferencia, 2));

  update public.cobro_solicitudes
  set resultado = v_result
  where sociedad_id = p_sociedad_id
    and request_key = p_request_key;

  return v_result;
end;
$$;

revoke all on function public.registrar_cobro_masivo_diferencia_cc(uuid, jsonb, jsonb, jsonb, date, uuid, uuid, numeric, text) from public, anon;
grant execute on function public.registrar_cobro_masivo_diferencia_cc(uuid, jsonb, jsonb, jsonb, date, uuid, uuid, numeric, text) to authenticated;

commit;
