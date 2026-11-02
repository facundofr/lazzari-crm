-- Auditoría integral, Tanda 6 (02/11/2026, Augusto: "1 lo confirmo"): anular y editar un cobro desde Finanzas > Recibos.
-- La Finanzas vieja lo hacía de a un movimiento; un recibo tiene varios (medios + retenciones), así que ahora se anula o
-- se edita el recibo entero en una sola operación: si algo falla, no cambia nada.
-- Solo agrega dos funciones; no toca tablas ni las funciones que ya existen (usa gestionar_cobro y anular_liquidacion_fx).
-- Cheques: no se tocan (los mueve solo el banco, Augusto 26/10); gestionar_cobro solo avisa.
-- Banco: la línea cruzada con el cobro vuelve a quedar sin cruzar (como gestionar_cobro desde el 28/10). En un cobro en US$
-- con liquidación también se descruza antes, porque anular_liquidacion_fx pedía "desconciliá primero" (avisar, nunca trabar).
-- Vuelta atrás: supabase/rollback/20261102160000_anular_editar_recibo.sql. Prueba: scripts/db/pruebas/anular_editar_recibo.sql

begin;

create or replace function public.anular_recibo(p_recibo_id uuid, p_motivo text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rec public.recibos%rowtype;
  v_movs uuid[];
  v_fx uuid;
  v_mov uuid;
  v_res jsonb;
  v_lineas integer := 0;
  v_anulados integer := 0;
  v_avisos jsonb := '[]'::jsonb;
  v_motivo text := nullif(trim(coalesce(p_motivo, '')), '');
begin
  if auth.uid() is null then
    raise exception 'Sesión no válida';
  end if;
  select * into v_rec from public.recibos where id = p_recibo_id for update;
  if not found then
    raise exception 'No se encontró el recibo';
  end if;
  if not public.lz_puede_operar_finanzas(v_rec.sociedad_id) then
    raise exception 'No tenés permiso para anular cobros de esta sociedad' using errcode = '42501';
  end if;

  select coalesce(array_agg(m.id), '{}') into v_movs
  from public.recibo_movimientos rm
  join public.movimientos m on m.id = rm.movimiento_id
  where rm.recibo_id = p_recibo_id and not coalesce(m.anulado, false);
  if cardinality(v_movs) = 0 then
    return jsonb_build_object('ok', true, 'replayed', true, 'anulados', 0, 'avisos', '[]'::jsonb);
  end if;

  -- Cobro en US$ con liquidación: se descruza del banco y se anula la liquidación entera (sus movimientos y aplicaciones).
  for v_fx in
    select distinct m.liquidacion_fx_id from public.movimientos m
    where m.id = any (v_movs) and m.liquidacion_fx_id is not null
  loop
    with lineas as (
      update public.extracto_movimientos em
      set estado = 'pendiente', match_movimiento_id = null,
          match_cliente_id = null, match_proveedor_id = null, match_factura_id = null
      where em.match_movimiento_id in (select id from public.movimientos where liquidacion_fx_id = v_fx)
      returning em.id
    )
    select count(*) into v_lineas from lineas;
    update public.movimientos set extracto_movimiento_id = null, conciliado = false
    where liquidacion_fx_id = v_fx and (extracto_movimiento_id is not null or conciliado);
    if v_lineas > 0 then
      v_avisos := v_avisos || to_jsonb(v_lineas || ' línea(s) del banco vuelven a quedar sin cruzar.');
    end if;
    perform public.anular_liquidacion_fx(v_fx, v_rec.sociedad_id);
    if v_motivo is not null then
      -- Sus movimientos están protegidos (proteger_movimiento_fx): el motivo se anota con el mismo permiso de la anulación.
      perform set_config('app.fx_anular', v_fx::text, true);
      update public.movimientos set descripcion = descripcion || ' · Motivo: ' || v_motivo where liquidacion_fx_id = v_fx and id = any (v_movs);
      perform set_config('app.fx_anular', '', true);
    end if;
  end loop;

  -- El resto (pesos, retenciones): la misma función de siempre, renglón por renglón (cheques y banco: solo avisa).
  for v_mov in
    select m.id from public.movimientos m
    where m.id = any (v_movs) and m.liquidacion_fx_id is null and not coalesce(m.anulado, false)
  loop
    v_res := public.gestionar_cobro(v_mov, 'anular');
    v_avisos := v_avisos || coalesce(v_res -> 'avisos', '[]'::jsonb);
  end loop;

  if v_motivo is not null then
    update public.movimientos set descripcion = descripcion || ' · Motivo: ' || v_motivo where id = any (v_movs) and liquidacion_fx_id is null;
  end if;

  select count(*) into v_anulados from public.movimientos where id = any (v_movs) and coalesce(anulado, false);
  return jsonb_build_object('ok', true, 'replayed', false, 'anulados', v_anulados, 'avisos', v_avisos);
end;
$$;

-- p_renglones: [{ "movimiento_id": "...", "monto": 123.45 }] (solo los que cambian). p_fecha: la fecha de todo el recibo.
create or replace function public.editar_recibo(p_recibo_id uuid, p_fecha date default null, p_renglones jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rec public.recibos%rowtype;
  v_r jsonb;
  v_m public.movimientos%rowtype;
  v_monto numeric;
  v_cambios integer := 0;
  v_avisos jsonb := '[]'::jsonb;
  v_cheque text;
begin
  if auth.uid() is null then
    raise exception 'Sesión no válida';
  end if;
  select * into v_rec from public.recibos where id = p_recibo_id for update;
  if not found then
    raise exception 'No se encontró el recibo';
  end if;
  if not public.lz_puede_operar_finanzas(v_rec.sociedad_id) then
    raise exception 'No tenés permiso para editar cobros de esta sociedad' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.recibo_movimientos rm join public.movimientos m on m.id = rm.movimiento_id
    where rm.recibo_id = p_recibo_id and m.liquidacion_fx_id is not null and not coalesce(m.anulado, false)
  ) then
    raise exception 'Este cobro en US$ tiene liquidación de cambio y no se edita: anulalo y cargalo de nuevo.';
  end if;

  for v_r in select * from jsonb_array_elements(coalesce(p_renglones, '[]'::jsonb)) loop
    select m.* into v_m
    from public.movimientos m
    join public.recibo_movimientos rm on rm.movimiento_id = m.id
    where rm.recibo_id = p_recibo_id and m.id = (v_r ->> 'movimiento_id')::uuid
    for update of m;
    if not found then
      raise exception 'Un renglón no es de este recibo';
    end if;
    if coalesce(v_m.anulado, false) then
      continue;
    end if;
    v_monto := round((v_r ->> 'monto')::numeric, 2);
    if v_monto is null or abs(v_monto - v_m.monto) < 0.005 then
      continue;
    end if;
    perform public.gestionar_cobro(v_m.id, 'editar', null, v_monto, null, null, null);
    v_cambios := v_cambios + 1;
    if coalesce(v_m.conciliado, false) or v_m.extracto_movimiento_id is not null then
      v_avisos := v_avisos || to_jsonb('«' || coalesce(v_m.descripcion, 'Renglón') || '» estaba cruzado con el banco por ' || to_char(v_m.monto, 'FM999G999G999G990D00') || ': revisalo en Bancos.');
    end if;
    select string_agg(coalesce(e.numero, '?'), ', ') into v_cheque from public.echeqs e where e.movimiento_id = v_m.id;
    if v_cheque is not null then
      v_avisos := v_avisos || to_jsonb('El cheque ' || v_cheque || ' no cambia: su importe y su estado los dice el banco.');
    end if;
  end loop;

  if p_fecha is not null and p_fecha is distinct from v_rec.fecha then
    -- Se pasa el mismo monto: así gestionar_cobro no lo toma como cambio de importe en un cobro repartido en varias facturas.
    for v_m in
      select m.* from public.movimientos m join public.recibo_movimientos rm on rm.movimiento_id = m.id
      where rm.recibo_id = p_recibo_id and not coalesce(m.anulado, false)
    loop
      perform public.gestionar_cobro(v_m.id, 'editar', null, v_m.monto, null, p_fecha, null);
    end loop;
    update public.recibos set fecha = p_fecha where id = p_recibo_id;
    v_cambios := v_cambios + 1;
  end if;

  return jsonb_build_object('ok', true, 'cambios', v_cambios, 'avisos', v_avisos);
end;
$$;

revoke all on function public.anular_recibo(uuid, text) from public, anon;
revoke all on function public.editar_recibo(uuid, date, jsonb) from public, anon;
grant execute on function public.anular_recibo(uuid, text) to authenticated;
grant execute on function public.editar_recibo(uuid, date, jsonb) to authenticated;

commit;
