-- Correcciones del circuito de Finanzas (DIAGNOSTICO-FINANCIERO.md) — TODOS los cambios son ADITIVOS.
-- Para deshacer: supabase/rollback/20261011100000_finanzas_correcciones.sql
--
--  A6  Cheques atados a su cobro:
--      · echeqs.movimiento_id (el cobro que generó el cheque) + vínculo automático al cargarlo.
--      · rechazar_cheque_recibido(): marca el cheque rechazado, anula el cobro, reabre la factura y deja un aviso.
--      · gestionar_cobro(): al anular un cobro, anula también su cheque si sigue en cartera.
--  A7  anular_factura_compra(): anula sin borrar, avisa si tenía pagos (quedan a favor del proveedor) y libera la OC.
--  A9b gestionar_cobro(): pide rol (admin/super_admin/administrativo) Y pertenecer a la sociedad. Borrar: solo admin.
--  B9  movimientos.ajuste_sentido: los ajustes manuales se graban con tipo "ajuste" (no son plata).
--  B10 movimientos.gasto_manual_id: el pago queda atado a su gasto manual.
--  D3  movimientos.conciliado_por / conciliado_at (se completan solos) + desconciliar_movimiento().
--
-- Se corre entero en el SQL Editor de Supabase. Se puede correr más de una vez.

-- El tipo "ajuste" ya existe en la base; esto solo lo asegura. (Va fuera de la transacción.)
alter type public.movimiento_tipo add value if not exists 'ajuste';

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- Columnas y tabla nuevas
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.echeqs
  add column if not exists movimiento_id uuid references public.movimientos(id) on delete set null;
create index if not exists echeqs_movimiento_id_idx on public.echeqs (movimiento_id) where movimiento_id is not null;
comment on column public.echeqs.movimiento_id is 'Movimiento de cobro que generó este cheque recibido (para rechazo y anulación).';

alter table public.movimientos
  add column if not exists gasto_manual_id uuid references public.gastos_manuales(id) on delete set null,
  add column if not exists conciliado_por uuid references public.profiles(id) on delete set null,
  add column if not exists conciliado_at timestamptz,
  add column if not exists ajuste_sentido text;
alter table public.movimientos drop constraint if exists movimientos_ajuste_sentido_check;
alter table public.movimientos add constraint movimientos_ajuste_sentido_check
  check (ajuste_sentido is null or ajuste_sentido in ('credito', 'debito'));
create index if not exists movimientos_gasto_manual_id_idx on public.movimientos (gasto_manual_id) where gasto_manual_id is not null;
comment on column public.movimientos.gasto_manual_id is 'Gasto manual que originó este pago.';
comment on column public.movimientos.ajuste_sentido is 'Solo ajustes manuales: credito = a favor del cliente/proveedor; debito = cargo.';

-- Archivo de lo que se deshace al anular una factura de compra (no se pierde nada).
create table if not exists public.factura_compra_anulaciones (
  id uuid primary key default gen_random_uuid(),
  sociedad_id uuid not null references public.sociedades(id),
  factura_compra_id uuid not null references public.facturas_compra(id) on delete cascade,
  motivo text,
  estado_anterior text,
  pagado numeric(20,2) not null default 0,
  asignaciones jsonb not null default '[]'::jsonb,
  ordenes_compra uuid[] not null default '{}',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists factura_compra_anulaciones_factura_idx on public.factura_compra_anulaciones (factura_compra_id);
alter table public.factura_compra_anulaciones enable row level security;
revoke all on public.factura_compra_anulaciones from anon, authenticated;
grant select on public.factura_compra_anulaciones to authenticated;
drop policy if exists factura_compra_anulaciones_read on public.factura_compra_anulaciones;
create policy factura_compra_anulaciones_read on public.factura_compra_anulaciones
  for select to authenticated using (
    exists (select 1 from public.user_sociedades us
            where us.user_id = auth.uid() and us.sociedad_id = factura_compra_anulaciones.sociedad_id)
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- Utilidades
-- ─────────────────────────────────────────────────────────────────────────────

-- Rol de finanzas Y pertenecer a la sociedad (las dos cosas).
create or replace function public.lz_puede_operar_finanzas(p_sociedad_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and coalesce(p.active, true)
        and p.role::text in ('super_admin', 'admin', 'administrativo')
    )
    and exists (
      select 1 from public.user_sociedades us
      where us.user_id = auth.uid() and us.sociedad_id = p_sociedad_id
    );
$$;
revoke all on function public.lz_puede_operar_finanzas(uuid) from public, anon;
grant execute on function public.lz_puede_operar_finanzas(uuid) to authenticated;

-- Cheques recibidos que generó un movimiento de cobro.
-- Primero el vínculo guardado; si no hay (cheques viejos), un único cheque del mismo cliente,
-- mismo importe y cargado en el mismo momento (±5 min). Si hay duda, no devuelve nada.
create or replace function public.lz_echeqs_de_movimiento(p_movimiento_id uuid)
returns uuid[]
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_m public.movimientos%rowtype;
  v_ids uuid[];
begin
  select coalesce(array_agg(e.id order by e.id), '{}') into v_ids
  from public.echeqs e where e.movimiento_id = p_movimiento_id;
  if cardinality(v_ids) > 0 then return v_ids; end if;

  select * into v_m from public.movimientos where id = p_movimiento_id;
  if not found or v_m.tipo::text <> 'cheque_recibido' or v_m.cliente_id is null then
    return '{}';
  end if;

  select coalesce(array_agg(e.id order by e.id), '{}') into v_ids
  from public.echeqs e
  where e.sociedad_id = v_m.sociedad_id
    and e.movimiento_id is null
    and coalesce(e.direccion, 'recibido') = 'recibido'
    and e.origen_id = v_m.cliente_id
    and round(e.monto::numeric, 2) = round((case when coalesce(v_m.anulado, false) then coalesce(v_m.monto_original, v_m.monto) else v_m.monto end)::numeric, 2)
    and abs(extract(epoch from (e.created_at - v_m.created_at))) <= 300;
  if cardinality(v_ids) = 1 then return v_ids; end if;
  return '{}';
end;
$$;
revoke all on function public.lz_echeqs_de_movimiento(uuid) from public, anon, authenticated;

-- Movimiento de cobro que generó un cheque recibido (inverso del anterior, mismo criterio prudente).
create or replace function public.lz_movimiento_de_echeq(p_echeq_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_e public.echeqs%rowtype;
  v_ids uuid[];
begin
  select * into v_e from public.echeqs where id = p_echeq_id;
  if not found then return null; end if;
  if v_e.movimiento_id is not null then return v_e.movimiento_id; end if;
  if v_e.origen_id is null then return null; end if;

  -- 1) Cargado en el mismo momento que el cobro
  select coalesce(array_agg(m.id order by m.id), '{}') into v_ids
  from public.movimientos m
  where m.sociedad_id = v_e.sociedad_id
    and m.cliente_id = v_e.origen_id
    and m.tipo::text = 'cheque_recibido'
    and not coalesce(m.anulado, false)
    and round(m.monto::numeric, 2) = round(v_e.monto::numeric, 2)
    and abs(extract(epoch from (m.created_at - v_e.created_at))) <= 300
    and not exists (select 1 from public.echeqs o where o.movimiento_id = m.id);
  if cardinality(v_ids) = 1 then return v_ids[1]; end if;
  if cardinality(v_ids) > 1 then return null; end if;

  -- 2) Mismo cliente, importe y número de cheque en la descripción
  if nullif(trim(coalesce(v_e.numero, '')), '') is not null and length(trim(v_e.numero)) >= 4 then
    select coalesce(array_agg(m.id order by m.id), '{}') into v_ids
    from public.movimientos m
    where m.sociedad_id = v_e.sociedad_id
      and m.cliente_id = v_e.origen_id
      and m.tipo::text = 'cheque_recibido'
      and not coalesce(m.anulado, false)
      and round(m.monto::numeric, 2) = round(v_e.monto::numeric, 2)
      and position(trim(v_e.numero) in coalesce(m.descripcion, '')) > 0
      and not exists (select 1 from public.echeqs o where o.movimiento_id = m.id);
    if cardinality(v_ids) = 1 then return v_ids[1]; end if;
  end if;
  return null;
end;
$$;
revoke all on function public.lz_movimiento_de_echeq(uuid) from public, anon, authenticated;

-- Al cargar un cheque recibido dentro de un cobro, queda atado a su movimiento.
-- (Las funciones de cobro crean primero el movimiento y después el cheque, en la misma transacción.)
create or replace function public.lz_echeqs_vincular_movimiento()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_mov uuid;
begin
  if new.movimiento_id is null
    and coalesce(new.direccion, 'recibido') = 'recibido'
    and new.origen_id is not null
    and new.sociedad_id is not null then
    begin
      select m.id into v_mov
      from public.movimientos m
      where m.sociedad_id = new.sociedad_id
        and m.cliente_id = new.origen_id
        and m.tipo::text = 'cheque_recibido'
        and not coalesce(m.anulado, false)
        and round(m.monto::numeric, 2) = round(new.monto::numeric, 2)
        and m.created_at >= now() - interval '2 minutes'
        and not exists (select 1 from public.echeqs e where e.movimiento_id = m.id)
      order by m.created_at desc, m.id
      limit 1;
      new.movimiento_id := v_mov;
    exception when others then
      -- Nunca frenar la carga del cheque por el vínculo.
      new.movimiento_id := null;
    end;
  end if;
  return new;
end;
$$;
drop trigger if exists lz_echeqs_vincular_movimiento on public.echeqs;
create trigger lz_echeqs_vincular_movimiento
  before insert on public.echeqs
  for each row execute function public.lz_echeqs_vincular_movimiento();

-- Quién y cuándo concilió (también cuando concilia el extracto bancario).
create or replace function public.lz_movimientos_conciliado_audit()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if coalesce(new.conciliado, false) then
      new.conciliado_por := coalesce(new.conciliado_por, auth.uid());
      new.conciliado_at := coalesce(new.conciliado_at, now());
    end if;
  elsif coalesce(new.conciliado, false) and not coalesce(old.conciliado, false) then
    new.conciliado_por := coalesce(new.conciliado_por, auth.uid());
    new.conciliado_at := coalesce(new.conciliado_at, now());
  elsif not coalesce(new.conciliado, false) and coalesce(old.conciliado, false) then
    new.conciliado_por := null;
    new.conciliado_at := null;
  end if;
  return new;
end;
$$;
drop trigger if exists lz_movimientos_conciliado_audit on public.movimientos;
create trigger lz_movimientos_conciliado_audit
  before insert or update of conciliado on public.movimientos
  for each row execute function public.lz_movimientos_conciliado_audit();

-- ─────────────────────────────────────────────────────────────────────────────
-- gestionar_cobro (A6b + A9b): rol Y sociedad; anular también anula el cheque en cartera;
-- borrar físicamente solo admin/super_admin. Misma firma que antes.
-- ─────────────────────────────────────────────────────────────────────────────
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
  v_cobrado numeric := 0;
  v_total numeric := 0;
  v_acreditado numeric := 0;
  v_es_admin boolean := false;
  v_cheques uuid[] := array[]::uuid[];
  v_echeq record;
  v_cheques_anulados integer := 0;
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

      -- A6b: el cheque que generó este cobro deja de estar disponible.
      v_cheques := public.lz_echeqs_de_movimiento(p_movimiento_id);
      for v_echeq in
        select e.id, e.numero, e.estado from public.echeqs e
        where e.id = any (v_cheques)
        for update
      loop
        if v_echeq.estado in ('en_cartera', 'pendiente', 'vencido') then
          update public.echeqs
          set estado = 'anulado',
              movimiento_id = case when p_accion = 'eliminar' then null else p_movimiento_id end,
              observaciones = concat_ws(' | ', nullif(observaciones, ''), '[Anulado ' || v_hoy || '] se anuló el cobro')
          where id = v_echeq.id;
          v_cheques_anulados := v_cheques_anulados + 1;
        elsif v_echeq.estado not in ('anulado', 'rechazado') then
          update public.echeqs set movimiento_id = case when p_accion = 'eliminar' then null else p_movimiento_id end
          where id = v_echeq.id and movimiento_id is null;
          v_avisos := v_avisos || to_jsonb('El cheque ' || coalesce(v_echeq.numero, '') || ' ya está ' || v_echeq.estado || ': revisalo a mano.');
        end if;
      end loop;

      if v_aplicaciones > 0 then
        delete from public.cobro_aplicaciones where movimiento_id = p_movimiento_id;
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
$$;

revoke all on function public.gestionar_cobro(uuid, text, text, numeric, text, date, text) from public, anon;
grant execute on function public.gestionar_cobro(uuid, text, text, numeric, text, date, text) to authenticated;
comment on function public.gestionar_cobro is
  'Edita, anula o elimina (solo admin) un cobro, anula su cheque en cartera y recalcula el estado de sus facturas.';

-- ─────────────────────────────────────────────────────────────────────────────
-- A6: rechazar un cheque recibido
-- ─────────────────────────────────────────────────────────────────────────────
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

-- ─────────────────────────────────────────────────────────────────────────────
-- A7: anular una factura de compra (no borra nada; avisa, no frena)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.anular_factura_compra(p_factura_id uuid, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fc public.facturas_compra%rowtype;
  v_pago_op numeric := 0;
  v_pago_directo numeric := 0;
  v_credito_nc numeric := 0;
  v_avisos jsonb := '[]'::jsonb;
  v_asignaciones jsonb;
  v_ocs uuid[];
  v_motivo text := coalesce(nullif(trim(p_motivo), ''), 'sin motivo');
  v_hoy text := to_char(now() at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY');
  v_res jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sesión no válida';
  end if;

  select * into v_fc from public.facturas_compra where id = p_factura_id for update;
  if not found then
    raise exception 'No se encontró la factura de compra';
  end if;
  if not public.lz_puede_operar_finanzas(v_fc.sociedad_id) then
    raise exception 'No tenés permiso para anular facturas de compra en esta sociedad' using errcode = '42501';
  end if;
  if v_fc.estado = 'anulada' then
    return jsonb_build_object('ok', true, 'replayed', true, 'factura_compra_id', v_fc.id, 'avisos', '[]'::jsonb);
  end if;

  -- Una NC se anula con su propia función: revierte el crédito en todas las facturas.
  if upper(coalesce(v_fc.tipo_comprobante, '')) like 'NC%' then
    v_res := public.anular_nota_credito_compra_v2(v_fc.sociedad_id, v_fc.id);
    update public.facturas_compra
    set notas = concat_ws(E'\n', nullif(notas, ''), '[Anulada ' || v_hoy || '] ' || v_motivo)
    where id = v_fc.id;
    return coalesce(v_res, '{}'::jsonb) || jsonb_build_object('ok', true, 'factura_compra_id', v_fc.id, 'avisos', '[]'::jsonb);
  end if;

  select coalesce(sum(a.monto), 0) into v_pago_op
  from public.op_facturas_compra a
  join public.ordenes_pago op on op.id = a.orden_pago_id
  where a.factura_compra_id = v_fc.id and op.estado <> 'anulada';

  select coalesce(sum(coalesce(m.monto, 0) + coalesce(m.retencion_ganancias_monto, 0)), 0) into v_pago_directo
  from public.movimientos m
  where m.factura_compra_id = v_fc.id and m.tipo::text = 'pago'
    and not coalesce(m.anulado, false) and m.nota_credito_compra_id is null;

  select greatest(coalesce(v_fc.total_acreditado, 0), coalesce(sum(m.monto), 0)) into v_credito_nc
  from public.movimientos m
  where m.factura_compra_id = v_fc.id and m.nota_credito_compra_id is not null and not coalesce(m.anulado, false);

  if v_pago_op + v_pago_directo > 0.005 then
    v_avisos := v_avisos || to_jsonb('La factura tenía pagos por ' || to_char(v_pago_op + v_pago_directo, 'FM999G999G999G990D00')
      || ': quedan registrados como saldo a favor del proveedor.');
  end if;
  if v_credito_nc > 0.005 then
    v_avisos := v_avisos || to_jsonb('Tenía notas de crédito aplicadas por ' || to_char(v_credito_nc, 'FM999G999G999G990D00')
      || ': si corresponde, anulá también la NC.');
  end if;

  -- Libera las líneas de OC (se guardan en el archivo antes de quitarlas).
  select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb), coalesce(array_agg(distinct a.orden_compra_id), '{}')
    into v_asignaciones, v_ocs
  from public.factura_compra_asignaciones a
  where a.factura_compra_id = v_fc.id;

  insert into public.factura_compra_anulaciones (
    sociedad_id, factura_compra_id, motivo, estado_anterior, pagado, asignaciones, ordenes_compra, created_by
  ) values (
    v_fc.sociedad_id, v_fc.id, v_motivo, v_fc.estado, round(v_pago_op + v_pago_directo, 2), v_asignaciones, v_ocs, auth.uid()
  );

  delete from public.factura_compra_asignaciones where factura_compra_id = v_fc.id;

  if cardinality(v_ocs) > 0 then
    update public.ordenes_compra o set estado_facturacion = case
        when s.pendiente <= 0.0001 then 'facturada'
        when s.asignada > 0 then 'parcial'
        else null end
    from (
      select i.orden_id, sum(i.cantidad - coalesce(a.asignada, 0)) as pendiente, sum(coalesce(a.asignada, 0)) as asignada
      from public.orden_compra_items i
      left join (select orden_compra_item_id, sum(cantidad) as asignada
                 from public.factura_compra_asignaciones group by orden_compra_item_id) a
        on a.orden_compra_item_id = i.id
      where i.orden_id = any (v_ocs)
      group by i.orden_id
    ) s
    where o.id = s.orden_id;
  end if;

  update public.facturas_compra
  set estado = 'anulada',
      notas = concat_ws(E'\n', nullif(notas, ''), '[Anulada ' || v_hoy || '] ' || v_motivo)
  where id = v_fc.id;

  return jsonb_build_object(
    'ok', true,
    'replayed', false,
    'factura_compra_id', v_fc.id,
    'pagado', round(v_pago_op + v_pago_directo, 2),
    'ordenes_compra', to_jsonb(v_ocs),
    'avisos', v_avisos
  );
end;
$$;
revoke all on function public.anular_factura_compra(uuid, text) from public, anon;
grant execute on function public.anular_factura_compra(uuid, text) to authenticated;
comment on function public.anular_factura_compra is
  'Anula una factura de compra sin borrarla: avisa si tenía pagos (quedan a favor del proveedor) y libera sus líneas de OC.';

-- ─────────────────────────────────────────────────────────────────────────────
-- D3: desconciliar
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.desconciliar_movimiento(p_movimiento_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mov public.movimientos%rowtype;
  v_lineas integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Sesión no válida';
  end if;
  select * into v_mov from public.movimientos where id = p_movimiento_id for update;
  if not found then
    raise exception 'El movimiento ya no existe';
  end if;
  if not public.lz_puede_operar_finanzas(v_mov.sociedad_id) then
    raise exception 'No tenés permiso para desconciliar en esta sociedad' using errcode = '42501';
  end if;

  update public.movimientos
  set conciliado = false, conciliado_por = null, conciliado_at = null
  where id = p_movimiento_id;

  -- Si estaba conciliado contra una línea del extracto, la línea vuelve a quedar pendiente.
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
  select count(*) into v_lineas from lineas;

  return jsonb_build_object('ok', true, 'movimiento_id', p_movimiento_id, 'lineas_extracto', v_lineas);
end;
$$;
revoke all on function public.desconciliar_movimiento(uuid) from public, anon;
grant execute on function public.desconciliar_movimiento(uuid) to authenticated;

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- CONSULTAS DE CONTROL (solo lectura)
-- Pegar de a una en el SQL Editor para ver registros que quedaron mal por los errores viejos.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- 1) Cheques RECHAZADOS cuyo cobro sigue vigente (la factura figura cobrada):
-- select e.id, e.numero, e.origen_nombre, e.monto, e.fecha_pago, m.id as movimiento_id, m.descripcion, m.factura_id
-- from public.echeqs e
-- join public.movimientos m
--   on m.sociedad_id = e.sociedad_id and m.cliente_id = e.origen_id and m.tipo::text = 'cheque_recibido'
--  and round(m.monto::numeric, 2) = round(e.monto::numeric, 2)
--  and (m.id = e.movimiento_id or abs(extract(epoch from (m.created_at - e.created_at))) <= 300)
-- where e.estado = 'rechazado' and coalesce(e.direccion, 'recibido') = 'recibido' and not coalesce(m.anulado, false)
-- order by e.fecha_pago desc;
--
-- 2) Cobros ANULADOS cuyo cheque sigue en cartera (se podría depositar o endosar):
-- select e.id, e.numero, e.origen_nombre, e.monto, e.estado, m.id as movimiento_id, m.descripcion
-- from public.echeqs e
-- join public.movimientos m
--   on m.sociedad_id = e.sociedad_id and m.cliente_id = e.origen_id and m.tipo::text = 'cheque_recibido'
--  and round(coalesce(m.monto_original, m.monto)::numeric, 2) = round(e.monto::numeric, 2)
--  and (m.id = e.movimiento_id or abs(extract(epoch from (m.created_at - e.created_at))) <= 300)
-- where coalesce(m.anulado, false) and e.estado in ('en_cartera', 'pendiente')
-- order by m.fecha desc;
--
-- 3) Facturas de compra ANULADAS que tienen pagos vigentes (plata a favor del proveedor):
-- select fc.id, fc.numero_factura, p.razon_social, fc.total, fc.moneda,
--   coalesce((select sum(a.monto) from public.op_facturas_compra a join public.ordenes_pago op on op.id = a.orden_pago_id
--             where a.factura_compra_id = fc.id and op.estado <> 'anulada'), 0) as pagado_op,
--   coalesce((select sum(m.monto + coalesce(m.retencion_ganancias_monto, 0)) from public.movimientos m
--             where m.factura_compra_id = fc.id and m.tipo::text = 'pago' and not coalesce(m.anulado, false)
--               and m.nota_credito_compra_id is null), 0) as pagado_directo
-- from public.facturas_compra fc join public.proveedores p on p.id = fc.proveedor_id
-- where fc.estado = 'anulada'
-- order by fc.fecha desc;
--
-- 4) Facturas de compra ANULADAS que todavía ocupan líneas de OC (traban la conciliación):
-- select fc.id, fc.numero_factura, a.orden_compra_id, count(*) as lineas, sum(a.cantidad) as cantidad
-- from public.factura_compra_asignaciones a join public.facturas_compra fc on fc.id = a.factura_compra_id
-- where fc.estado = 'anulada'
-- group by fc.id, fc.numero_factura, a.orden_compra_id;
--
-- 5) Notas de crédito de compra ANULADAS con la función vieja que dejaron crédito aplicado vigente:
-- select nc.id, nc.numero_factura, m.factura_compra_id, m.monto
-- from public.facturas_compra nc join public.movimientos m on m.nota_credito_compra_id = nc.id
-- where nc.estado = 'anulada' and not coalesce(m.anulado, false);
--
-- 6) "Ajustes manuales" viejos que entraron a la caja como cobro o pago:
-- select id, fecha, tipo, monto, moneda, descripcion, cliente_id, proveedor_id
-- from public.movimientos
-- where descripcion ilike '[Ajuste manual]%' and tipo::text <> 'ajuste' and not coalesce(anulado, false)
-- order by fecha desc;
--
-- 7) Gastos manuales sin su pago atado (los viejos): revisar si el pago coincide con el gasto:
-- select g.id, g.fecha, g.descripcion, g.monto, g.moneda,
--   (select count(*) from public.movimientos m where m.gasto_manual_id = g.id) as pagos_atados
-- from public.gastos_manuales g
-- where not exists (select 1 from public.movimientos m where m.gasto_manual_id = g.id)
-- order by g.fecha desc;
--
-- 8) Pagos de gastos cuyo gasto ya no existe o cambió de importe (la caja resta de más o de menos):
-- select m.id, m.fecha, m.monto, m.descripcion
-- from public.movimientos m
-- where m.tipo::text = 'pago' and m.descripcion like 'Gasto — %' and m.gasto_manual_id is null and not coalesce(m.anulado, false)
-- order by m.fecha desc;
--
-- 9) Facturas de venta "pagada" que, sumando bien, no están pagadas (cobro anulado o contado dos veces):
-- select f.id, f.tipo, f.punto_venta, f.numero, f.total, f.total_acreditado,
--   coalesce((select sum(m.monto) from public.movimientos m where m.factura_id = f.id and not coalesce(m.anulado, false)
--             and not exists (select 1 from public.cobro_aplicaciones ca where ca.movimiento_id = m.id)), 0)
--   + coalesce((select sum(ca.monto) from public.cobro_aplicaciones ca join public.movimientos m on m.id = ca.movimiento_id
--               where ca.factura_id = f.id and not coalesce(m.anulado, false)), 0) as cobrado
-- from public.facturas f
-- where f.estado = 'pagada'
--   and f.total - coalesce(f.total_acreditado, 0)
--     - coalesce((select sum(m.monto) from public.movimientos m where m.factura_id = f.id and not coalesce(m.anulado, false)
--                 and not exists (select 1 from public.cobro_aplicaciones ca where ca.movimiento_id = m.id)), 0)
--     - coalesce((select sum(ca.monto) from public.cobro_aplicaciones ca join public.movimientos m on m.id = ca.movimiento_id
--                 where ca.factura_id = f.id and not coalesce(m.anulado, false)), 0) > 0.01;
