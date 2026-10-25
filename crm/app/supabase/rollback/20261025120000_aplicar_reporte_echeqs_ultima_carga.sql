-- Vuelta atrás de 20261025120000_aplicar_reporte_echeqs_ultima_carga.sql
-- Vuelve a la función anterior (la de 20261024140000): sin registrar la fecha cuando el estado del banco no cambia.
begin;

create or replace function public.aplicar_reporte_echeqs(p_sociedad_id uuid, p_cheques jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_c jsonb;
  v_cheq text;
  v_num text;
  v_monto numeric;
  v_dir text;
  v_est text;
  v_banco text;
  v_pag boolean;
  v_id uuid;
  v_n integer;
  v_row public.echeqs%rowtype;
  v_vinculados integer := 0;
  v_actualizados integer := 0;
  v_sin_cambio integer := 0;
  v_pagados integer := 0;
  v_n_no_estan integer := 0;
  v_n_conflictos integer := 0;
  v_no_estan jsonb := '[]'::jsonb;
  v_conflictos jsonb := '[]'::jsonb;
  v_diferencias jsonb := '[]'::jsonb;
begin
  if not public.lz_puede_operar_finanzas(p_sociedad_id) then raise exception 'No tenés permisos para cargar cheques en esta sociedad'; end if;
  if jsonb_typeof(p_cheques) <> 'array' then raise exception 'Cheques inválidos'; end if;

  for v_c in select value from jsonb_array_elements(p_cheques)
  loop
    v_cheq := nullif(trim(v_c->>'cheq_id'), '');
    v_num := ltrim(nullif(trim(v_c->>'numero'), ''), '0');
    v_monto := nullif(trim(v_c->>'monto'), '')::numeric;
    v_dir := v_c->>'direccion';
    v_est := upper(coalesce(nullif(trim(v_c->>'estado_banco'), ''), ''));
    v_banco := regexp_replace(upper(coalesce(v_c->>'banco_emisor', '')), '[^A-Z]', '', 'g');
    v_pag := coalesce((v_c->>'pagado_antes_corte')::boolean, false);

    if v_cheq is null or v_num is null or v_monto is null or v_dir is null or v_dir not in ('emitido', 'recibido') then
      v_n_conflictos := v_n_conflictos + 1;
      if jsonb_array_length(v_conflictos) < 50 then
        v_conflictos := v_conflictos || jsonb_build_object('numero', v_c->>'numero', 'cheq_id', v_c->>'cheq_id', 'motivo', 'Datos incompletos (falta CheqID, número, monto o dirección)');
      end if;
      continue;
    end if;

    v_id := null;
    select id into v_id from public.echeqs where sociedad_id = p_sociedad_id and cheq_id = v_cheq limit 1;

    if v_id is null then
      select count(*) into v_n from public.echeqs
        where sociedad_id = p_sociedad_id and direccion = v_dir and cheq_id is null
          and ltrim(numero, '0') = v_num and round(monto, 2) = round(v_monto, 2);
      if v_n = 1 then
        select id into v_id from public.echeqs
          where sociedad_id = p_sociedad_id and direccion = v_dir and cheq_id is null
            and ltrim(numero, '0') = v_num and round(monto, 2) = round(v_monto, 2);
      elsif v_n > 1 then
        -- Desempate 1: anulado o no, según el estado del banco (copia anulada vs. la buena).
        select count(*), (array_agg(id))[1] into v_n, v_id from public.echeqs
          where sociedad_id = p_sociedad_id and direccion = v_dir and cheq_id is null
            and ltrim(numero, '0') = v_num and round(monto, 2) = round(v_monto, 2)
            and ((v_est = 'ANULADO') = (estado = 'anulado'));
        -- Desempate 2: si siguen siendo varios, el mismo banco (comparado sin símbolos ni espacios).
        if v_n > 1 and v_banco <> '' then
          select count(*), (array_agg(id))[1] into v_n, v_id from public.echeqs
            where sociedad_id = p_sociedad_id and direccion = v_dir and cheq_id is null
              and ltrim(numero, '0') = v_num and round(monto, 2) = round(v_monto, 2)
              and ((v_est = 'ANULADO') = (estado = 'anulado'))
              and regexp_replace(upper(coalesce(banco_emisor, '')), '[^A-Z]', '', 'g') = v_banco;
        end if;
        if v_n <> 1 then
          v_id := null;
          v_n_conflictos := v_n_conflictos + 1;
          if jsonb_array_length(v_conflictos) < 50 then
            v_conflictos := v_conflictos || jsonb_build_object('numero', v_c->>'numero', 'cheq_id', v_cheq, 'monto', v_monto, 'motivo', 'Hay más de un cheque en el CRM con ese número y monto: no se pudo elegir uno');
          end if;
          continue;
        end if;
      else
        v_n_no_estan := v_n_no_estan + 1;
        if jsonb_array_length(v_no_estan) < 50 then
          v_no_estan := v_no_estan || jsonb_build_object('numero', v_c->>'numero', 'cheq_id', v_cheq, 'monto', v_monto, 'estado_banco', v_est,
            'motivo', case when exists (select 1 from public.echeqs where sociedad_id = p_sociedad_id and direccion = v_dir and ltrim(numero, '0') = v_num)
              then 'El número está en el CRM pero con otro monto o ya con otro CheqID' else 'No está en el CRM' end);
        end if;
        continue;
      end if;
    end if;

    select * into v_row from public.echeqs where id = v_id;

    -- Encontrado por CheqID pero con otro número o monto: dato raro, no se toca.
    if ltrim(v_row.numero, '0') <> v_num or round(v_row.monto, 2) <> round(v_monto, 2) then
      v_n_conflictos := v_n_conflictos + 1;
      if jsonb_array_length(v_conflictos) < 50 then
        v_conflictos := v_conflictos || jsonb_build_object('numero', v_c->>'numero', 'cheq_id', v_cheq, 'monto', v_monto,
          'motivo', 'El CRM tiene ese CheqID con el número ' || v_row.numero || ' y monto ' || v_row.monto);
      end if;
      continue;
    end if;

    if v_row.cheq_id is null then
      update public.echeqs set cheq_id = v_cheq where id = v_id;
      v_vinculados := v_vinculados + 1;
    end if;

    if v_est <> '' and v_row.estado_banco is distinct from v_est then
      update public.echeqs set estado_banco = v_est, estado_banco_at = now() where id = v_id;
      v_actualizados := v_actualizados + 1;
    else
      v_sin_cambio := v_sin_cambio + 1;
    end if;

    -- Único cambio de estado del CRM: emitido pagado por el banco antes del corte.
    if v_est = 'PAGADO' and v_dir = 'emitido' and v_pag then
      update public.echeqs set estado = 'cobrado' where id = v_id and estado in ('pendiente', 'entregado');
      if found then v_pagados := v_pagados + 1; end if;
    end if;

    -- Rechazados y anulados que el CRM no tiene así: se avisa, no se cambia solo.
    if (v_est = 'RECHAZADO' and v_row.estado <> 'rechazado') or (v_est = 'ANULADO' and v_row.estado <> 'anulado') then
      if jsonb_array_length(v_diferencias) < 50 then
        v_diferencias := v_diferencias || jsonb_build_object('numero', v_c->>'numero', 'cheq_id', v_cheq, 'monto', v_monto, 'crm', v_row.estado, 'banco', v_est);
      end if;
    end if;
  end loop;

  return jsonb_build_object('vinculados', v_vinculados, 'actualizados', v_actualizados, 'sin_cambio', v_sin_cambio, 'pagados', v_pagados,
    'no_estan_total', v_n_no_estan, 'conflictos_total', v_n_conflictos,
    'no_estan', v_no_estan, 'conflictos', v_conflictos, 'diferencias', v_diferencias);
end;
$$;
revoke all on function public.aplicar_reporte_echeqs(uuid, jsonb) from public, anon;
grant execute on function public.aplicar_reporte_echeqs(uuid, jsonb) to authenticated;

commit;
