-- H15 (auditoría integral): anular o borrar un cobro/gasto deja la línea del extracto del banco "conciliada" contra un movimiento anulado.
-- gestionar_cobro ahora libera esas líneas (vuelven a pendiente, el extracto a parcial), como desconciliar_movimiento. Solo avisa.
-- Aditivo: solo reemplaza la función. Vuelta atrás: supabase/rollback/20261028160000_anular_cobro_libera_extracto.sql
begin;

CREATE OR REPLACE FUNCTION public.gestionar_cobro(p_movimiento_id uuid, p_accion text, p_descripcion text DEFAULT NULL::text, p_monto numeric DEFAULT NULL::numeric, p_moneda text DEFAULT NULL::text, p_fecha date DEFAULT NULL::date, p_tipo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_lineas_extracto integer := 0;
  v_mov public.movimientos%rowtype;
  v_facturas uuid[] := array[]::uuid[];
  v_facturas_aplicadas uuid[] := array[]::uuid[];
  v_factura_id uuid;
  v_aplicaciones integer := 0;
  v_cobrado numeric := 0;
  v_total numeric := 0;
  v_acreditado numeric := 0;
  v_es_admin boolean := false;
  v_cheques uuid[] := array[]::uuid[];
  v_echeq record;
  v_cheques_anulados integer := 0; -- queda en 0: ya no se anulan cheques (se devuelve igual para las pantallas)
  v_avisos jsonb := '[]'::jsonb;
  v_hoy text := to_char(now() at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY');
begin
  if auth.uid() is null then
    raise exception 'Sesión no válida';
  end if;

  select * into v_mov
  from public.movimientos
  where id = p_movimiento_id
  for update;

  if not found then
    raise exception 'El cobro ya no existe';
  end if;

  -- A9b: hace falta el rol Y pertenecer a la sociedad del movimiento.
  if not public.lz_puede_operar_finanzas(v_mov.sociedad_id) then
    raise exception 'No tenés permiso para operar este cobro' using errcode = '42501';
  end if;

  v_es_admin := exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role::text in ('super_admin', 'admin')
  );

  if v_mov.factura_id is not null then
    v_facturas := array_append(v_facturas, v_mov.factura_id);
  end if;

  select coalesce(array_agg(distinct factura_id), array[]::uuid[]), count(*)
    into v_facturas_aplicadas, v_aplicaciones
  from public.cobro_aplicaciones
  where movimiento_id = p_movimiento_id;
  v_facturas := v_facturas || v_facturas_aplicadas;

  case p_accion
    when 'editar' then
      if v_mov.anulado then
        raise exception 'Un cobro anulado no se puede editar';
      end if;
      if coalesce(p_monto, v_mov.monto) <= 0 then
        raise exception 'El monto debe ser mayor a cero';
      end if;
      if v_aplicaciones > 1 and p_monto is distinct from v_mov.monto then
        raise exception 'Este cobro está distribuido entre varias facturas; el monto no puede modificarse desde una sola línea';
      end if;

      update public.movimientos
      set descripcion = coalesce(nullif(trim(p_descripcion), ''), descripcion),
          monto = coalesce(p_monto, monto),
          moneda = coalesce(nullif(p_moneda, '')::public.moneda_type, moneda),
          fecha = coalesce(p_fecha, fecha),
          tipo = coalesce(nullif(p_tipo, '')::public.movimiento_tipo, tipo)
      where id = p_movimiento_id;

      if v_aplicaciones = 1 and p_monto is not null then
        update public.cobro_aplicaciones set monto = p_monto where movimiento_id = p_movimiento_id;
      end if;

    when 'anular', 'eliminar' then
      if p_accion = 'eliminar' and not v_es_admin then
        raise exception 'Solo un administrador puede borrar un movimiento. Usá «Anular»: conserva el registro y recalcula la factura.' using errcode = '42501';
      end if;
      if p_accion = 'anular' and v_mov.anulado then
        raise exception 'El cobro ya está anulado';
      end if;

      -- 26/10/2026 (Augusto): anular o borrar el cobro NO cambia el estado de sus cheques ("quien define es el banco").
      -- Solo se guarda (o se suelta, si se borra) el vínculo con el cobro, y se avisa de los que siguen en cartera.
      -- (Antes acá los cheques en cartera pasaban a "anulado".)
      v_cheques := public.lz_echeqs_de_movimiento(p_movimiento_id);
      for v_echeq in
        select e.id, e.numero, e.estado from public.echeqs e
        where e.id = any (v_cheques)
        for update
      loop
        update public.echeqs set movimiento_id = case when p_accion = 'eliminar' then null else p_movimiento_id end
        where id = v_echeq.id and (movimiento_id is null or movimiento_id = p_movimiento_id);
        if v_echeq.estado in ('en_cartera', 'pendiente', 'vencido', 'depositado') then
          v_avisos := v_avisos || to_jsonb('El cheque ' || coalesce(v_echeq.numero, '') || ' sigue ' || replace(v_echeq.estado, '_', ' ') || ': no se cambia, lo que pase con él lo dice el banco.');
        end if;
      end loop;

      if v_aplicaciones > 0 then
        delete from public.cobro_aplicaciones where movimiento_id = p_movimiento_id;
      end if;

      -- 28/10/2026 (H15): la línea del extracto conciliada contra este cobro vuelve a pendiente, igual que desconciliar_movimiento.
      -- Va antes del delete: después el vínculo ya no se encuentra. Solo avisa, nunca frena.
      with lineas as (
        update public.extracto_movimientos em
        set estado = 'pendiente', match_movimiento_id = null,
            match_cliente_id = null, match_proveedor_id = null, match_factura_id = null
        where em.match_movimiento_id = p_movimiento_id
        returning em.extracto_id
      ), extractos as (
        update public.extractos_bancarios eb
        set estado = 'parcial'::public.extracto_estado
        where eb.id in (select extracto_id from lineas) and eb.sociedad_id = v_mov.sociedad_id
        returning eb.id
      )
      select count(*) into v_lineas_extracto from lineas;
      if v_lineas_extracto > 0 then
        v_avisos := v_avisos || to_jsonb(v_lineas_extracto || ' línea(s) del extracto del banco vuelven a pendientes: reclasificalas en Bancos.');
      end if;

      if p_accion = 'anular' then
        update public.movimientos
        set anulado = true,
            monto_original = monto,
            monto = 0,
            anulado_at = now(),
            anulado_por = auth.uid(),
            conciliado = false,
            descripcion = '[ANULADO] ' || regexp_replace(descripcion, '^\[ANULADO\]\s*', '')
        where id = p_movimiento_id;
      else
        delete from public.movimientos where id = p_movimiento_id;
      end if;

    else
      raise exception 'Acción inválida';
  end case;

  foreach v_factura_id in array v_facturas loop
    select total, coalesce(total_acreditado, 0)
      into v_total, v_acreditado
    from public.facturas
    where id = v_factura_id;

    if found then
      -- Cobros directos (sin aplicaciones, para no contarlos dos veces) + aplicaciones vigentes.
      select coalesce(sum(m.monto), 0)
        into v_cobrado
      from public.movimientos m
      where m.factura_id = v_factura_id
        and not coalesce(m.anulado, false)
        and not exists (select 1 from public.cobro_aplicaciones ca where ca.movimiento_id = m.id);

      v_cobrado := v_cobrado + coalesce((
        select sum(ca.monto)
        from public.cobro_aplicaciones ca
        join public.movimientos m on m.id = ca.movimiento_id
        where ca.factura_id = v_factura_id and not coalesce(m.anulado, false)
      ), 0);

      update public.facturas
      set estado = case
        when estado = 'anulada' then estado
        when v_cobrado + v_acreditado >= v_total - 0.01 then 'pagada'::public.factura_status
        when v_cobrado + v_acreditado > 0 then 'parcial'::public.factura_status
        else 'emitida'::public.factura_status
      end
      where id = v_factura_id;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'accion', p_accion,
    'movimiento_id', p_movimiento_id,
    'facturas', to_jsonb(v_facturas),
    'cheques_anulados', v_cheques_anulados,
    'avisos', v_avisos
  );
end;
$function$;

revoke all on function public.gestionar_cobro(uuid, text, text, numeric, text, date, text) from public, anon;
grant execute on function public.gestionar_cobro(uuid, text, text, numeric, text, date, text) to authenticated;

commit;
