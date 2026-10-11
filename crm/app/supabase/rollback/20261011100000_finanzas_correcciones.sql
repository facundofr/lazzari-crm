-- Deshace 20261011100000_finanzas_correcciones.sql
-- Vuelve gestionar_cobro a la versión de 20260902160000_manage_cobros.sql y quita lo agregado.
-- ATENCIÓN:
--  · Se pierden los vínculos cheque↔cobro, gasto↔pago, quién concilió y el archivo de facturas de compra anuladas.
--  · Lo que ya se hizo con las funciones nuevas (cheques rechazados, cobros/facturas anuladas) queda como está.
--  · El valor "ajuste" del tipo de movimiento no se puede quitar (ya existía antes; no molesta).

begin;

drop trigger if exists lz_echeqs_vincular_movimiento on public.echeqs;
drop trigger if exists lz_movimientos_conciliado_audit on public.movimientos;

drop function if exists public.rechazar_cheque_recibido(uuid, text);
drop function if exists public.anular_factura_compra(uuid, text);
drop function if exists public.desconciliar_movimiento(uuid);
drop function if exists public.lz_echeqs_vincular_movimiento();
drop function if exists public.lz_movimientos_conciliado_audit();
drop function if exists public.lz_echeqs_de_movimiento(uuid);
drop function if exists public.lz_movimiento_de_echeq(uuid);

-- gestionar_cobro tal como estaba (20260902160000_manage_cobros.sql)
create or replace function public.gestionar_cobro(
  p_movimiento_id uuid,
  p_accion text,
  p_descripcion text default null,
  p_monto numeric default null,
  p_moneda text default null,
  p_fecha date default null,
  p_tipo text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mov public.movimientos%rowtype;
  v_facturas uuid[] := array[]::uuid[];
  v_facturas_aplicadas uuid[] := array[]::uuid[];
  v_factura_id uuid;
  v_aplicaciones integer := 0;
  v_tiene_aplicaciones boolean := false;
  v_cobrado numeric := 0;
  v_total numeric := 0;
  v_acreditado numeric := 0;
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

  if not (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('super_admin', 'admin', 'administrativo'))
    or exists (
      select 1 from public.user_sociedades us
      where us.user_id = auth.uid() and us.sociedad_id = v_mov.sociedad_id
    )
  ) then
    raise exception 'No tenés permiso para operar este cobro';
  end if;

  if v_mov.factura_id is not null then
    v_facturas := array_append(v_facturas, v_mov.factura_id);
  end if;

  v_tiene_aplicaciones := to_regclass('public.cobro_aplicaciones') is not null
     and exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'cobro_aplicaciones' and column_name = 'movimiento_id'
     );

  if v_tiene_aplicaciones then
    execute 'select coalesce(array_agg(distinct factura_id), array[]::uuid[]), count(*) from public.cobro_aplicaciones where movimiento_id = $1'
      into v_facturas_aplicadas, v_aplicaciones
      using p_movimiento_id;
    v_facturas := v_facturas || v_facturas_aplicadas;
  end if;

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
        execute 'update public.cobro_aplicaciones set monto = $1 where movimiento_id = $2'
          using p_monto, p_movimiento_id;
      end if;

    when 'anular' then
      if v_mov.anulado then
        raise exception 'El cobro ya está anulado';
      end if;
      if v_aplicaciones > 0 then
        execute 'delete from public.cobro_aplicaciones where movimiento_id = $1' using p_movimiento_id;
      end if;
      update public.movimientos
      set anulado = true,
          monto_original = monto,
          monto = 0,
          anulado_at = now(),
          anulado_por = auth.uid(),
          conciliado = false,
          descripcion = '[ANULADO] ' || regexp_replace(descripcion, '^\[ANULADO\]\s*', '')
      where id = p_movimiento_id;

    when 'eliminar' then
      if v_aplicaciones > 0 then
        execute 'delete from public.cobro_aplicaciones where movimiento_id = $1' using p_movimiento_id;
      end if;
      delete from public.movimientos where id = p_movimiento_id;

    else
      raise exception 'Acción inválida';
  end case;

  foreach v_factura_id in array v_facturas loop
    select total, coalesce(total_acreditado, 0)
      into v_total, v_acreditado
    from public.facturas
    where id = v_factura_id;

    if found then
      select coalesce(sum(monto), 0)
        into v_cobrado
      from public.movimientos
      where factura_id = v_factura_id and not coalesce(anulado, false);

      if v_tiene_aplicaciones then
        execute 'select coalesce(sum(ca.monto), 0) from public.cobro_aplicaciones ca join public.movimientos m on m.id = ca.movimiento_id where ca.factura_id = $1 and not coalesce(m.anulado, false)'
          into v_total
          using v_factura_id;
        v_cobrado := v_cobrado + coalesce(v_total, 0);
        select total, coalesce(total_acreditado, 0) into v_total, v_acreditado from public.facturas where id = v_factura_id;
      end if;

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

  return jsonb_build_object('ok', true, 'accion', p_accion, 'movimiento_id', p_movimiento_id);
end;
$$;

grant execute on function public.gestionar_cobro(uuid, text, text, numeric, text, date, text) to authenticated;

comment on function public.gestionar_cobro is
  'Edita, anula o elimina un cobro y recalcula el estado de sus facturas vinculadas.';

-- lz_puede_operar_finanzas la usaba solo gestionar_cobro nuevo: se quita después de restaurarla.
drop function if exists public.lz_puede_operar_finanzas(uuid);

drop table if exists public.factura_compra_anulaciones;

alter table public.movimientos drop constraint if exists movimientos_ajuste_sentido_check;
drop index if exists public.movimientos_gasto_manual_id_idx;
drop index if exists public.echeqs_movimiento_id_idx;
alter table public.movimientos
  drop column if exists gasto_manual_id,
  drop column if exists conciliado_por,
  drop column if exists conciliado_at,
  drop column if exists ajuste_sentido;
alter table public.echeqs drop column if exists movimiento_id;

commit;
