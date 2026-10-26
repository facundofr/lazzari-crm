-- Vuelta atrás de 20261026130000_finanzas_simple.sql
-- Vuelve aplicar_cruces_extracto a la versión de 20261011180000 (sin "solo_pendiente") y saca actualizar_cheques_segun_banco.
-- No toca datos: los cheques que ya cambiaron de estado quedan como están.
begin;

create or replace function public.aplicar_cruces_extracto(p_sociedad_id uuid, p_cruces jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_c jsonb;
  v_linea public.extracto_movimientos%rowtype;
  v_clas text;
  v_mov_id uuid;
  v_cheque_id uuid;
  v_cheque public.echeqs%rowtype;
  v_aplicadas integer := 0;
  v_extractos uuid[] := '{}';
begin
  if not public.lz_puede_operar_finanzas(p_sociedad_id) then raise exception 'No tenés permisos para conciliar en esta sociedad'; end if;
  if jsonb_typeof(p_cruces) <> 'array' then raise exception 'Cruces inválidos'; end if;

  for v_c in select value from jsonb_array_elements(p_cruces)
  loop
    select em.* into v_linea from public.extracto_movimientos em
      join public.extractos_bancarios eb on eb.id = em.extracto_id
      where em.id = (v_c->>'linea_id')::uuid and eb.sociedad_id = p_sociedad_id
      for update of em;
    if not found then raise exception 'Línea del extracto no disponible'; end if;
    v_clas := nullif(v_c->>'clasificacion', '');
    v_mov_id := nullif(v_c->>'movimiento_id', '')::uuid;
    v_cheque_id := nullif(v_c->>'cheque_id', '')::uuid;

    -- Deshacer lo anterior de la línea (si tenía algo).
    if v_linea.match_movimiento_id is not null and v_linea.match_movimiento_id is distinct from v_mov_id then
      update public.movimientos set conciliado = false, conciliado_at = null, conciliado_por = null
        where id = v_linea.match_movimiento_id and sociedad_id = p_sociedad_id;
    end if;
    if v_linea.cheque_id is not null and (v_linea.cheque_id is distinct from v_cheque_id or v_clas is distinct from v_linea.clasificacion) then
      update public.echeqs set estado = case
          when direccion = 'emitido' then case when destino_nombre is not null or destino_id is not null then 'entregado' else 'pendiente' end
          else 'depositado' end
        where id = v_linea.cheque_id and sociedad_id = p_sociedad_id and estado = 'cobrado'
          and v_linea.clasificacion in ('cheque_emitido', 'cheque_acreditado');
    end if;

    if v_clas is null then
      update public.extracto_movimientos set estado = 'pendiente', clasificacion = null, subtipo = null,
        match_movimiento_id = null, match_cliente_id = null, match_proveedor_id = null, match_factura_id = null,
        cheque_id = null, contra_cuenta_id = null, nota = null, clasificado_por = null, clasificado_at = null
        where id = v_linea.id;
    else
      if v_mov_id is not null then
        if not exists (select 1 from public.movimientos where id = v_mov_id and sociedad_id = p_sociedad_id and not coalesce(anulado, false)) then
          raise exception 'El movimiento elegido no existe o está anulado';
        end if;
        if exists (select 1 from public.extracto_movimientos where match_movimiento_id = v_mov_id and id <> v_linea.id) then
          raise exception 'Ese movimiento ya está cruzado con otra línea del extracto';
        end if;
        update public.movimientos set conciliado = true, conciliado_at = now(), conciliado_por = auth.uid(),
          cuenta_id = coalesce(v_linea.cuenta_id, cuenta_id)
          where id = v_mov_id and sociedad_id = p_sociedad_id;
      end if;
      if v_cheque_id is not null then
        select * into v_cheque from public.echeqs where id = v_cheque_id and sociedad_id = p_sociedad_id for update;
        if not found then raise exception 'El cheque elegido no existe en esta sociedad'; end if;
        if v_clas = 'cheque_emitido' and v_cheque.estado in ('pendiente', 'entregado') then
          update public.echeqs set estado = 'cobrado' where id = v_cheque_id;
        elsif v_clas = 'cheque_acreditado' and v_cheque.estado in ('en_cartera', 'depositado') then
          update public.echeqs set estado = 'cobrado', fecha_deposito = coalesce(fecha_deposito, v_linea.fecha) where id = v_cheque_id;
        end if;
      end if;
      update public.extracto_movimientos set
        clasificacion = v_clas,
        subtipo = nullif(v_c->>'subtipo', ''),
        match_movimiento_id = v_mov_id,
        match_cliente_id = (select cliente_id from public.movimientos where id = v_mov_id),
        match_proveedor_id = (select proveedor_id from public.movimientos where id = v_mov_id),
        match_factura_id = (select factura_id from public.movimientos where id = v_mov_id),
        cheque_id = v_cheque_id,
        contra_cuenta_id = nullif(v_c->>'contra_cuenta_id', '')::uuid,
        nota = nullif(v_c->>'nota', ''),
        -- Cobro o pago sin movimiento del CRM = falta cargarlo: queda pendiente.
        estado = case when v_clas in ('cobro', 'pago') and v_mov_id is null then 'pendiente' else 'matcheado' end::public.extracto_mov_estado,
        clasificado_por = auth.uid(), clasificado_at = now()
        where id = v_linea.id;
    end if;
    v_aplicadas := v_aplicadas + 1;
    v_extractos := array_append(v_extractos, v_linea.extracto_id);
  end loop;

  update public.extractos_bancarios eb set estado = case when exists (
      select 1 from public.extracto_movimientos where extracto_id = eb.id and estado::text = 'pendiente'
    ) then 'parcial'::public.extracto_estado else 'conciliado'::public.extracto_estado end
    where eb.id = any(v_extractos) and eb.sociedad_id = p_sociedad_id;

  return jsonb_build_object('aplicadas', v_aplicadas);
end;
$$;

drop function if exists public.actualizar_cheques_segun_banco(uuid, boolean);

commit;
