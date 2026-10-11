-- Vuelta atrás de 20261011160000_facturas_cheque_rechazado.sql:
-- rechazar_cheque_recibido vuelve a la versión de 20261011100000 y se quitan las dos columnas informativas.
begin;
create or replace function public.rechazar_cheque_recibido(p_cheque_id uuid, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_e public.echeqs%rowtype;
  v_mov_id uuid;
  v_mov public.movimientos%rowtype;
  v_res jsonb := null;
  v_avisos jsonb := '[]'::jsonb;
  v_motivo text := coalesce(nullif(trim(p_motivo), ''), 'sin motivo');
  v_hoy text := to_char(now() at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY');
  v_cobro_anulado boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Sesión no válida';
  end if;

  select * into v_e from public.echeqs where id = p_cheque_id for update;
  if not found then
    raise exception 'No se encontró el cheque';
  end if;
  if not public.lz_puede_operar_finanzas(v_e.sociedad_id) then
    raise exception 'No tenés permiso para rechazar cheques en esta sociedad' using errcode = '42501';
  end if;
  if coalesce(v_e.direccion, 'recibido') <> 'recibido' then
    raise exception 'Solo se rechazan cheques recibidos de clientes';
  end if;
  if v_e.estado = 'rechazado' then
    return jsonb_build_object('ok', true, 'replayed', true, 'cheque_id', v_e.id);
  end if;

  if v_e.estado = 'endosado' then
    v_avisos := v_avisos || to_jsonb('El cheque estaba endosado a ' || coalesce(v_e.destino_nombre, 'un tercero') || ': revisá la cuenta con quien lo recibió.');
  elsif v_e.estado = 'anulado' then
    v_avisos := v_avisos || to_jsonb('El cheque estaba anulado.'::text);
  end if;

  v_mov_id := public.lz_movimiento_de_echeq(v_e.id);

  update public.echeqs
  set estado = 'rechazado',
      movimiento_id = coalesce(movimiento_id, v_mov_id),
      observaciones = concat_ws(' | ', nullif(observaciones, ''), '[Rechazado ' || v_hoy || '] ' || v_motivo)
  where id = v_e.id;

  if v_mov_id is not null then
    select * into v_mov from public.movimientos where id = v_mov_id;
    if found and not coalesce(v_mov.anulado, false) then
      -- Anula el cobro y recalcula las facturas (la deuda del cliente vuelve a aparecer).
      v_res := public.gestionar_cobro(v_mov_id, 'anular');
      update public.movimientos
      set descripcion = '[ANULADO · cheque rechazado] ' || regexp_replace(descripcion, '^\[ANULADO\]\s*', '')
      where id = v_mov_id;
      v_cobro_anulado := true;
      v_avisos := v_avisos || coalesce(v_res->'avisos', '[]'::jsonb);
    end if;
  else
    v_avisos := v_avisos || to_jsonb('No se encontró el cobro que generó este cheque: revisá a mano la cuenta del cliente.'::text);
  end if;

  -- Aviso para que nadie se lo pierda (si falla, no frena el rechazo).
  begin
    insert into public.alertas (tipo, title, description, module, entity_type, entity_id, user_id, sociedad_id)
    values (
      'seguimiento',
      'Cheque rechazado: ' || coalesce(v_e.numero, 's/n') || coalesce(' — ' || v_e.origen_nombre, ''),
      'Cheque de ' || coalesce(v_e.origen_nombre, 'cliente') || ' por ' || coalesce(v_e.moneda, 'ARS') || ' '
        || to_char(v_e.monto, 'FM999G999G999G990D00') || '. Motivo: ' || v_motivo || '. '
        || case when v_cobro_anulado then 'Se anuló el cobro y la factura volvió a quedar pendiente.'
                else 'Revisá la cuenta corriente del cliente.' end,
      'finanzas',
      'cliente',
      v_e.origen_id,
      null,
      v_e.sociedad_id
    );
  exception when others then
    v_avisos := v_avisos || to_jsonb('No se pudo dejar el aviso: ' || sqlerrm);
  end;

  return jsonb_build_object(
    'ok', true,
    'replayed', false,
    'cheque_id', v_e.id,
    'movimiento_id', v_mov_id,
    'cobro_anulado', v_cobro_anulado,
    'facturas', coalesce(v_res->'facturas', '[]'::jsonb),
    'avisos', v_avisos
  );
end;
$$;
revoke all on function public.rechazar_cheque_recibido(uuid, text) from public, anon;
grant execute on function public.rechazar_cheque_recibido(uuid, text) to authenticated;
comment on function public.rechazar_cheque_recibido is
  'Marca un cheque recibido como rechazado, anula el cobro que lo generó, reabre la factura y deja un aviso.';

alter table public.facturas
  drop column if exists cheque_rechazado_motivo,
  drop column if exists cheque_rechazado_at;

commit;
