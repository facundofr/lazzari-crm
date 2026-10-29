-- Auditoría integral, Tanda 5 — H48 (29/10/2026, OK de Augusto): "Llegó" de Compras Lazza en UNA transacción.
-- Antes el navegador escribía renglón por renglón y después el estado de la OC; si se cortaba, o si dos personas
-- marcaban a la vez, quedaba a medias o una pisaba a la otra. Ahora:
--  * registrar_llegada_oc bloquea la OC (FOR UPDATE), suma o corrige sobre lo que hay en la base en ese momento
--    y deja el estado (recibida / recibida_parcial / enviada) todo junto. Si algo falla no se guarda nada.
--  * 'sumar': lo que llegó se suma a lo que ya había llegado, sin pasar de lo pedido (Completo y Parcial).
--  * 'corregir': el número es el TOTAL que llegó (puede bajar), entre 0 y lo pedido.
--  * Mismas reglas que lib/compras-recepcion.ts (estadoPorRecibido). Una OC anulada no cambia de estado.
--  * SECURITY INVOKER: los permisos son los mismos de hoy (las reglas de la tabla).
-- Aditivo: solo agrega una función. Vuelta atrás: supabase/rollback/20261029170000_llegada_oc_atomica.sql
begin;

create or replace function public.registrar_llegada_oc(p_oc_id uuid, p_sociedad_id uuid, p_renglones jsonb, p_modo text default 'sumar')
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_oc record;
  v_r jsonb;
  v_it record;
  v_cant numeric;
  v_nuevo numeric;
  v_cambios integer := 0;
  v_total integer;
  v_completos integer;
  v_algo integer;
  v_estado text;
  v_faltan integer;
begin
  if auth.uid() is null then
    raise exception 'Sesión no válida';
  end if;
  if p_modo not in ('sumar', 'corregir') then
    raise exception 'Modo inválido: %', p_modo using errcode = '22023';
  end if;
  if p_renglones is null or jsonb_typeof(p_renglones) <> 'array' then
    raise exception 'Faltan los artículos' using errcode = '22023';
  end if;

  select id, numero, estado::text as estado into v_oc
  from public.ordenes_compra where id = p_oc_id and sociedad_id = p_sociedad_id for update;
  if not found then
    raise exception 'No se encontró la OC' using errcode = 'P0002';
  end if;

  for v_r in select * from jsonb_array_elements(p_renglones) loop
    begin
      v_cant := round(coalesce((v_r->>'cantidad')::numeric, 0), 4);
    exception when invalid_text_representation then
      raise exception 'Cantidad inválida' using errcode = '22023';
    end;
    select id, descripcion, cantidad, coalesce(cantidad_recibida, 0) as recibida into v_it
    from public.orden_compra_items where id = (v_r->>'item_id')::uuid and orden_id = p_oc_id for update;
    if not found then
      raise exception 'Un artículo ya no está en %: volvé a abrirla', v_oc.numero using errcode = 'P0002';
    end if;
    if p_modo = 'sumar' then
      if v_cant <= 0 then continue; end if;
      v_nuevo := least(v_it.cantidad, v_it.recibida + v_cant);
    else
      v_nuevo := least(v_it.cantidad, greatest(0, v_cant));
    end if;
    if abs(v_nuevo - v_it.recibida) > 0.0001 then
      update public.orden_compra_items set cantidad_recibida = v_nuevo where id = v_it.id;
      v_cambios := v_cambios + 1;
    end if;
  end loop;

  -- Estado por lo recibido (igual que estadoPorRecibido). La OC anulada queda anulada.
  select count(*), count(*) filter (where coalesce(cantidad_recibida, 0) >= cantidad), count(*) filter (where coalesce(cantidad_recibida, 0) > 0),
         count(*) filter (where coalesce(cantidad_recibida, 0) < cantidad - 0.0001)
    into v_total, v_completos, v_algo, v_faltan
  from public.orden_compra_items where orden_id = p_oc_id;
  v_estado := v_oc.estado;
  if v_oc.estado <> 'cancelada' and v_total > 0 then
    if v_completos = v_total then v_estado := 'recibida';
    elsif v_algo > 0 then v_estado := 'recibida_parcial';
    elsif v_oc.estado in ('recibida', 'recibida_parcial') then v_estado := 'enviada';
    end if;
  end if;
  -- Siempre se escribe: el aviso automático de la tabla pudo haberlo movido al cambiar cada renglón.
  update public.ordenes_compra set estado = v_estado::public.oc_status where id = p_oc_id and estado::text is distinct from v_estado;

  return jsonb_build_object('cambios', v_cambios, 'estado', v_estado, 'faltan', v_faltan, 'numero', v_oc.numero);
end;
$$;

grant execute on function public.registrar_llegada_oc(uuid, uuid, jsonb, text) to authenticated;

commit;
