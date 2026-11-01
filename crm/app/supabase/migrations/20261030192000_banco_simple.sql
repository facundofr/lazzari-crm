-- Banco simple (Augusto 29–30/10/2026: "que el banco se clasifique solo, sin duplicar y sin confirmar nada"; OK "Sí, dale a todo").
-- Solo AGREGA 2 funciones (no cambia tablas ni datos). El que decide es el motor (lib/banco-motor, reglas seguras, sin IA):
--  procesar_banco(sociedad, decisiones): aplica las decisiones "cruzada" y "del_banco" sobre líneas PENDIENTES con
--    aplicar_cruces_extracto (la misma de siempre). Una línea puede explicar varios movimientos: todos quedan apuntando a la línea
--    (movimientos.extracto_movimiento_id, los dos lados). Cheque de papel rechazado: primero rechazar_cheque_recibido (el banco manda).
--    Si algo cambió mientras tanto (la línea ya no está pendiente o un movimiento ya está cruzado) esa línea se saltea; si una falla,
--    se deshace solo esa y sigue. Cada línea queda en finanzas_registro (accion 'cruce_solo', origen 'motor', con lo que había antes).
--    Una decisión "sin_cruzar" con aviso (cheque propio rechazado, o uno que no se sabe cuál es) no se aplica: deja el aviso en la
--    campana (alertas, módulo finanzas) una sola vez por línea. El cheque de papel rechazado ya avisa con rechazar_cheque_recibido.
--  deshacer_banco(sociedad, carga, linea): deshace lo que hizo el motor (una carga entera o una línea) y lo anota como 'desatada':
--    el motor no vuelve a hacer ese cruce. El rechazo de un cheque no se deshace (avisa).
-- Vuelta atrás: supabase/rollback/20261030192000_banco_simple.sql
begin;

create or replace function public.procesar_banco(p_sociedad_id uuid, p_decisiones jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_carga uuid := gen_random_uuid();
  v_d jsonb;
  v_linea public.extracto_movimientos%rowtype;
  v_movs uuid[];
  v_cheque uuid;
  v_antes jsonb;
  v_res jsonb;
  v_aplicadas integer := 0;
  v_salteadas integer := 0;
  v_avisos jsonb := '[]'::jsonb;
begin
  if not public.lz_puede_operar_finanzas(p_sociedad_id) then
    raise exception 'No tenés permisos para conciliar en esta sociedad' using errcode = '42501';
  end if;
  if jsonb_typeof(p_decisiones) <> 'array' then raise exception 'Decisiones inválidas'; end if;

  for v_d in select value from jsonb_array_elements(p_decisiones)
  loop
    -- Sin cruzar con aviso: a la campana, una sola vez por línea (si falla, no frena nada).
    if v_d->>'estado' = 'sin_cruzar' then
      if nullif(v_d->>'aviso', '') is not null
         and exists (select 1 from public.extracto_movimientos em join public.extractos_bancarios eb on eb.id = em.extracto_id
                      where em.id = (v_d->>'linea_id')::uuid and eb.sociedad_id = p_sociedad_id and em.estado::text = 'pendiente')
         and not exists (select 1 from public.alertas a where a.entity_type = 'extracto_movimiento' and a.entity_id = (v_d->>'linea_id')::uuid) then
        begin
          insert into public.alertas (tipo, title, description, module, entity_type, entity_id, user_id, sociedad_id)
          values ('seguimiento', 'Cheque rechazado por el banco', left(v_d->>'aviso', 1000), 'finanzas', 'extracto_movimiento',
                  (v_d->>'linea_id')::uuid, null, p_sociedad_id);
          v_avisos := v_avisos || to_jsonb(v_d->>'aviso');
        exception when others then
          v_avisos := v_avisos || to_jsonb('No se pudo dejar el aviso en la campana: ' || sqlerrm);
        end;
      end if;
      continue;
    end if;
    if coalesce(v_d->>'estado', '') not in ('cruzada', 'del_banco') then continue; end if;
    select em.* into v_linea from public.extracto_movimientos em
      join public.extractos_bancarios eb on eb.id = em.extracto_id
     where em.id = (v_d->>'linea_id')::uuid and eb.sociedad_id = p_sociedad_id
     for update of em;
    if not found or v_linea.estado::text <> 'pendiente' then v_salteadas := v_salteadas + 1; continue; end if;

    v_movs := coalesce(array(select x::uuid from jsonb_array_elements_text(coalesce(v_d->'movimientos', '[]'::jsonb)) x), '{}'::uuid[]);
    v_cheque := nullif(v_d->>'cheque_id', '')::uuid;
    -- Los movimientos tienen que seguir libres: de esta sociedad, sin anular y sin ninguna línea.
    if exists (
      select 1 from unnest(v_movs) as u(mid) left join public.movimientos m on m.id = u.mid
       where m.id is null or m.sociedad_id <> p_sociedad_id or coalesce(m.anulado, false) or m.extracto_movimiento_id is not null
          or exists (select 1 from public.extracto_movimientos x where x.match_movimiento_id = m.id)
    ) then
      v_salteadas := v_salteadas + 1; continue;
    end if;

    v_antes := jsonb_build_object(
      'movimientos', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'conciliado', m.conciliado, 'conciliado_at', m.conciliado_at,
        'conciliado_por', m.conciliado_por, 'cuenta_id', m.cuenta_id)) from public.movimientos m where m.id = any(v_movs)), '[]'::jsonb),
      'cheque', (select jsonb_build_object('id', c.id, 'estado', c.estado, 'fecha_deposito', c.fecha_deposito) from public.echeqs c where c.id = v_cheque));

    begin
      if coalesce((v_d->>'rechazar_cheque')::boolean, false) and v_cheque is not null then
        perform public.rechazar_cheque_recibido(v_cheque, left(coalesce(v_d->>'motivo', 'Rechazado por el banco'), 300));
      end if;
      v_res := public.aplicar_cruces_extracto(p_sociedad_id, jsonb_build_array(jsonb_build_object(
        'linea_id', v_linea.id, 'clasificacion', v_d->>'clasificacion', 'subtipo', v_d->>'subtipo',
        'movimiento_id', v_movs[1], 'cheque_id', v_cheque, 'contra_cuenta_id', v_d->>'contra_cuenta_id',
        'nota', left(coalesce(v_d->>'motivo', ''), 500), 'solo_pendiente', true)));
      if coalesce((v_res->>'aplicadas')::integer, 0) = 0 then
        v_salteadas := v_salteadas + 1; continue;
      end if;
      update public.movimientos m
         set extracto_movimiento_id = v_linea.id, conciliado = true,
             conciliado_at = coalesce(m.conciliado_at, now()), conciliado_por = coalesce(m.conciliado_por, auth.uid()),
             cuenta_id = coalesce(v_linea.cuenta_id, m.cuenta_id)
       where m.id = any(v_movs) and m.extracto_movimiento_id is null;
    exception when others then
      v_salteadas := v_salteadas + 1;
      v_avisos := v_avisos || to_jsonb('No se pudo procesar la línea del ' || to_char(v_linea.fecha, 'DD/MM') || ' por $ ' || v_linea.monto || ': ' || sqlerrm);
      continue;
    end;

    if coalesce((v_d->>'rechazar_cheque')::boolean, false) and nullif(v_d->>'aviso', '') is not null then
      v_avisos := v_avisos || to_jsonb(v_d->>'aviso');
    end if;
    insert into public.finanzas_registro (sociedad_id, usuario_id, linea_id, accion, tipo, origen, propuesta, resultado, resumen)
    values (p_sociedad_id, auth.uid(), v_linea.id, 'cruce_solo', v_d->>'clasificacion', 'motor',
      jsonb_build_object('carga', v_carga, 'estado', v_d->>'estado', 'movimientos', to_jsonb(v_movs), 'cheque_id', v_cheque,
        'contra_cuenta_id', v_d->>'contra_cuenta_id', 'rechazar_cheque', coalesce((v_d->>'rechazar_cheque')::boolean, false)),
      jsonb_build_object('antes', v_antes), left(coalesce(v_d->>'motivo', ''), 300));
    v_aplicadas := v_aplicadas + 1;
  end loop;

  return jsonb_build_object('carga', v_carga, 'aplicadas', v_aplicadas, 'salteadas', v_salteadas, 'avisos', v_avisos);
end;
$$;

create or replace function public.deshacer_banco(p_sociedad_id uuid, p_carga uuid default null, p_linea_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_r public.finanzas_registro%rowtype;
  v_linea public.extracto_movimientos%rowtype;
  v_movs uuid[];
  v_m jsonb;
  v_ch jsonb;
  v_n integer := 0;
  v_avisos jsonb := '[]'::jsonb;
begin
  if not public.lz_puede_operar_finanzas(p_sociedad_id) then
    raise exception 'No tenés permisos para conciliar en esta sociedad' using errcode = '42501';
  end if;
  if p_carga is null and p_linea_id is null then raise exception 'Falta qué deshacer'; end if;

  for v_r in
    select distinct on (r.linea_id) r.* from public.finanzas_registro r
     where r.sociedad_id = p_sociedad_id and r.accion = 'cruce_solo' and r.origen = 'motor' and r.linea_id is not null
       and (p_carga is null or r.propuesta->>'carga' = p_carga::text)
       and (p_linea_id is null or r.linea_id = p_linea_id)
     order by r.linea_id, r.created_at desc
  loop
    select * into v_linea from public.extracto_movimientos where id = v_r.linea_id for update;
    v_movs := coalesce(array(select x::uuid from jsonb_array_elements_text(coalesce(v_r.propuesta->'movimientos', '[]'::jsonb)) x), '{}'::uuid[]);
    -- Solo si la línea sigue como la dejó el motor (si una persona la cambió después, no se toca).
    if not found or v_linea.estado::text = 'pendiente'
       or v_linea.clasificacion is distinct from v_r.tipo
       or v_linea.match_movimiento_id is distinct from v_movs[1]
       or v_linea.cheque_id is distinct from nullif(v_r.propuesta->>'cheque_id', '')::uuid then
      continue;
    end if;

    perform public.aplicar_cruces_extracto(p_sociedad_id, jsonb_build_array(jsonb_build_object('linea_id', v_linea.id, 'clasificacion', null)));
    -- Los movimientos y el cheque vuelven a como estaban antes del motor.
    for v_m in select value from jsonb_array_elements(coalesce(v_r.resultado->'antes'->'movimientos', '[]'::jsonb))
    loop
      update public.movimientos set extracto_movimiento_id = null, conciliado = coalesce((v_m->>'conciliado')::boolean, false),
             conciliado_at = (v_m->>'conciliado_at')::timestamptz, conciliado_por = (v_m->>'conciliado_por')::uuid,
             cuenta_id = (v_m->>'cuenta_id')::uuid
       where id = (v_m->>'id')::uuid and sociedad_id = p_sociedad_id and extracto_movimiento_id = v_linea.id;
    end loop;
    v_ch := v_r.resultado->'antes'->'cheque';
    if coalesce((v_r.propuesta->>'rechazar_cheque')::boolean, false) then
      v_avisos := v_avisos || to_jsonb('El cheque ' || coalesce((select numero from public.echeqs where id = v_linea.cheque_id), '') || ' sigue rechazado: eso no se deshace solo.');
    elsif v_ch is not null and jsonb_typeof(v_ch) = 'object' then
      update public.echeqs set estado = v_ch->>'estado', fecha_deposito = (v_ch->>'fecha_deposito')::date
       where id = (v_ch->>'id')::uuid and sociedad_id = p_sociedad_id;
    end if;

    insert into public.finanzas_registro (sociedad_id, usuario_id, linea_id, accion, tipo, origen, propuesta, resumen)
    values (p_sociedad_id, auth.uid(), v_linea.id, 'desatada', v_r.tipo, 'persona',
      jsonb_build_object('carga', v_r.propuesta->>'carga', 'movimientos', to_jsonb(v_movs), 'cheque_id', v_r.propuesta->>'cheque_id'),
      'Deshecho: el banco no vuelve a hacer este cruce solo');
    v_n := v_n + 1;
  end loop;

  return jsonb_build_object('deshechas', v_n, 'avisos', v_avisos);
end;
$$;

revoke all on function public.procesar_banco(uuid, jsonb) from public, anon;
grant execute on function public.procesar_banco(uuid, jsonb) to authenticated;
revoke all on function public.deshacer_banco(uuid, uuid, uuid) from public, anon;
grant execute on function public.deshacer_banco(uuid, uuid, uuid) to authenticated;

comment on function public.procesar_banco(uuid, jsonb) is 'Banco simple (30/10/2026): aplica las decisiones del motor (lib/banco-motor) sobre las líneas pendientes, con registro para deshacer.';
comment on function public.deshacer_banco(uuid, uuid, uuid) is 'Banco simple (30/10/2026): deshace lo que hizo el motor (una carga o una línea); no lo vuelve a hacer.';

commit;
