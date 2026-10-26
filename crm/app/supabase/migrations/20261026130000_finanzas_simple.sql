-- Finanzas simple, tanda 1 (Augusto 26/10/2026). Cambios aditivos (dos funciones; no toca tablas ni datos).
-- 1) aplicar_cruces_extracto: si el cruce trae "solo_pendiente": true y la línea ya no está pendiente (la confirmó otra persona
--    u otra pestaña), la saltea y la devuelve en "salteadas". Sin esa marca hace exactamente lo mismo que antes.
-- 2) actualizar_cheques_segun_banco (nueva): los estados definitivos del banco (reportes de eCheq) actualizan el estado del CRM.
-- Vuelta atrás: supabase/rollback/20261026130000_finanzas_simple.sql
begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) aplicar_cruces_extracto (misma función de 20261011180000, con "solo_pendiente")
-- ─────────────────────────────────────────────────────────────────────────────
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
  v_salteadas jsonb := '[]'::jsonb;
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
    -- 26/10/2026 (Finanzas simple): la bandeja manda "solo_pendiente": si otra persona u otra pestaña ya la confirmó, no se pisa.
    if coalesce((v_c->>'solo_pendiente')::boolean, false) and v_linea.estado::text <> 'pendiente' then
      v_salteadas := v_salteadas || to_jsonb(v_linea.id);
      continue;
    end if;
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

  return jsonb_build_object('aplicadas', v_aplicadas, 'salteadas', v_salteadas);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Los reportes de eCheq actualizan el estado del CRM (Augusto 26/10/2026; reemplaza la regla del 23/10 "el banco no corrige al CRM").
--    Se corre después de aplicar_reporte_echeqs (que guarda estado_banco). Solo estados DEFINITIVOS del banco:
--      PAGADO    emitido en pendiente/entregado       → cobrado (debitado)
--      PAGADO    recibido en en_cartera/depositado     → cobrado
--      RECHAZADO recibido (no endosado)                → rechazar_cheque_recibido: anula el cobro y la factura vuelve a deber
--      RECHAZADO emitido                               → rechazado (+ aviso: revisar la OP)
--      ANULADO   en pendiente/entregado/en_cartera/depositado → anulado (+ aviso)
--    Los endosados no se tocan. Los intermedios (ACTIVO, PRESENTADO, CUSTODIA…) no cambian nada. No crea cheques.
--    p_probar = true: devuelve la lista de lo que cambiaría, sin cambiar nada.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.actualizar_cheques_segun_banco(p_sociedad_id uuid, p_probar boolean default false)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_e public.echeqs%rowtype;
  v_a text;
  v_aviso text;
  v_r jsonb;
  v_cambios jsonb := '[]'::jsonb;
begin
  if not public.lz_puede_operar_finanzas(p_sociedad_id) then raise exception 'No tenés permisos para cambiar cheques en esta sociedad'; end if;

  for v_e in
    select * from public.echeqs
    where sociedad_id = p_sociedad_id and estado_banco in ('PAGADO', 'RECHAZADO', 'ANULADO')
    order by fecha_pago nulls last, numero
    for update
  loop
    v_a := null; v_aviso := null;
    if v_e.estado_banco = 'PAGADO' and v_e.direccion = 'emitido' and v_e.estado in ('pendiente', 'entregado') then
      v_a := 'cobrado';
    elsif v_e.estado_banco = 'PAGADO' and v_e.direccion = 'recibido' and v_e.estado in ('en_cartera', 'depositado') then
      v_a := 'cobrado';
    elsif v_e.estado_banco = 'RECHAZADO' and v_e.direccion = 'recibido' and v_e.estado not in ('rechazado', 'anulado', 'endosado') then
      v_a := 'rechazado'; v_aviso := 'Se anula el cobro de este cheque y la factura vuelve a deber.';
    elsif v_e.estado_banco = 'RECHAZADO' and v_e.direccion = 'emitido' and v_e.estado not in ('rechazado', 'anulado') then
      v_a := 'rechazado'; v_aviso := 'Cheque propio rechazado: revisá la orden de pago con la que se pagó y avisale al proveedor.';
    elsif v_e.estado_banco = 'ANULADO' and v_e.estado in ('pendiente', 'entregado', 'en_cartera', 'depositado') then
      v_a := 'anulado'; v_aviso := case when v_e.direccion = 'emitido' then 'Revisá la orden de pago con la que se pagó.' else 'Revisá el cobro de este cheque.' end;
    end if;
    if v_a is null then continue; end if;

    if not p_probar then
      if v_a = 'rechazado' and v_e.direccion = 'recibido' then
        v_r := public.rechazar_cheque_recibido(v_e.id, 'Rechazado según el reporte de eCheq del banco');
        if coalesce((v_r->>'cobro_anulado')::boolean, false) is false then
          v_aviso := 'No se encontró el cobro de este cheque: revisá a mano la cuenta del cliente.';
        end if;
      else
        update public.echeqs set estado = v_a,
          observaciones = case when v_a in ('rechazado', 'anulado')
            then concat_ws(' | ', nullif(observaciones, ''), '[' || initcap(v_a) || ' según el banco ' || to_char(now() at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY') || ']')
            else observaciones end
          where id = v_e.id;
      end if;
    end if;

    v_cambios := v_cambios || jsonb_build_object(
      'id', v_e.id, 'numero', v_e.numero, 'monto', v_e.monto, 'direccion', v_e.direccion, 'fecha_pago', v_e.fecha_pago,
      'contraparte', coalesce(case when v_e.direccion = 'emitido' then v_e.destino_nombre else v_e.origen_nombre end, ''),
      'de', v_e.estado, 'a', v_a, 'banco', v_e.estado_banco, 'aviso', v_aviso);
  end loop;

  return jsonb_build_object('probar', p_probar, 'cambios', v_cambios);
end;
$$;
revoke all on function public.actualizar_cheques_segun_banco(uuid, boolean) from public, anon;
grant execute on function public.actualizar_cheques_segun_banco(uuid, boolean) to authenticated;

commit;
