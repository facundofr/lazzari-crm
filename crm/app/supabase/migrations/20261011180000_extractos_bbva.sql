-- Cuentas y extractos, etapa 2: importar el extracto del BBVA (Excel "Detalle_mov_cuenta") y cruzarlo.
--
-- 1) Líneas del extracto: cuenta, saldo, clave (para no duplicar al subir Excel que se pisan),
--    clasificación (cobro, pago, impuesto, gasto bancario, FCI, entre cuentas, tarjeta, cheques, personal…),
--    cheque y cuenta contraria.
-- 2) Cuentas: saldo según el banco (último saldo del extracto) y su fecha.
-- 3) Reglas "Recordar": un texto del concepto → siempre la misma clasificación.
-- 4) Cheques: quién lo cubre (cheques de Martín Fernández) y si ya cubrió.
-- 5) Funciones: importar_extracto_bbva, aplicar_cruces_extracto, completar_cheques_emitidos.
--
-- Cambios aditivos. Vuelta atrás: supabase/rollback/20261011180000_extractos_bbva.sql
begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Líneas del extracto
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.extracto_movimientos
  add column if not exists cuenta_id uuid references public.cuentas_financieras(id) on delete set null,
  add column if not exists saldo numeric(16, 2),
  add column if not exists sucursal text,
  add column if not exists clave text,
  add column if not exists clasificacion text,
  add column if not exists subtipo text,
  add column if not exists cheque_id uuid references public.echeqs(id) on delete set null,
  add column if not exists contra_cuenta_id uuid references public.cuentas_financieras(id) on delete set null,
  add column if not exists nota text,
  add column if not exists clasificado_por uuid references public.profiles(id) on delete set null,
  add column if not exists clasificado_at timestamptz;

alter table public.extracto_movimientos drop constraint if exists extracto_movimientos_clasificacion_check;
alter table public.extracto_movimientos add constraint extracto_movimientos_clasificacion_check
  check (clasificacion is null or clasificacion in (
    'cobro', 'pago', 'impuesto', 'gasto_bancario', 'intereses', 'fci', 'entre_cuentas', 'tarjeta',
    'cheque_emitido', 'cheque_acreditado', 'cheque_devuelto', 'personal', 'otro'
  ));

-- Misma línea del banco = misma cuenta + misma clave (fecha|importe|saldo|concepto).
create unique index if not exists extracto_movimientos_clave_unique
  on public.extracto_movimientos(cuenta_id, clave) where cuenta_id is not null and clave is not null;
create index if not exists extracto_movimientos_cuenta_fecha_idx
  on public.extracto_movimientos(cuenta_id, fecha) where cuenta_id is not null;
-- Un cheque se usa una sola vez por tipo (el mismo cheque puede tener depósito y devolución).
create unique index if not exists extracto_movimientos_cheque_unique
  on public.extracto_movimientos(cheque_id, clasificacion) where cheque_id is not null;

comment on column public.extracto_movimientos.clave is 'fecha|importe|saldo|concepto: evita duplicar líneas al subir extractos que se pisan.';
comment on column public.extracto_movimientos.clasificacion is 'Qué es la línea. cobro/pago sin match_movimiento_id = falta cargarlo en el CRM.';
comment on column public.extracto_movimientos.contra_cuenta_id is 'FCI, entre cuentas, tarjeta: la otra cuenta del pase.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Saldo según el banco
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.cuentas_financieras
  add column if not exists saldo_banco numeric(16, 2),
  add column if not exists saldo_banco_fecha date;
comment on column public.cuentas_financieras.saldo_banco is 'Último saldo del extracto importado (al cierre de saldo_banco_fecha).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Reglas "Recordar"
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.extracto_reglas (
  id uuid primary key default gen_random_uuid(),
  sociedad_id uuid not null references public.sociedades(id) on delete restrict,
  -- Texto que tiene que aparecer en el concepto (sin distinguir mayúsculas).
  texto text not null,
  -- credito / debito / null = cualquiera.
  sentido text check (sentido is null or sentido in ('credito', 'debito')),
  clasificacion text not null check (clasificacion in (
    'impuesto', 'gasto_bancario', 'intereses', 'fci', 'entre_cuentas', 'tarjeta', 'personal', 'otro'
  )),
  subtipo text,
  contra_cuenta_id uuid references public.cuentas_financieras(id) on delete set null,
  nota text,
  activa boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index if not exists extracto_reglas_sociedad_idx on public.extracto_reglas(sociedad_id) where activa;

alter table public.extracto_reglas enable row level security;
revoke all on public.extracto_reglas from anon, authenticated;
grant select, insert, update on public.extracto_reglas to authenticated;
drop policy if exists extracto_reglas_rw on public.extracto_reglas;
create policy extracto_reglas_rw on public.extracto_reglas
  for all to authenticated
  using (public.lz_puede_operar_finanzas(sociedad_id))
  with check (public.lz_puede_operar_finanzas(sociedad_id));

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Cheques que cubre un tercero (Martín Fernández)
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.echeqs
  add column if not exists cubre_tercero text,
  add column if not exists cubierto_at timestamptz;
create index if not exists echeqs_cubre_tercero_idx on public.echeqs(sociedad_id, fecha_pago) where cubre_tercero is not null;
comment on column public.echeqs.cubre_tercero is 'Cheque propio que cubre otra persona al vencimiento (ej. Martín Fernández). Cuenta en lo comprometido.';
comment on column public.echeqs.cubierto_at is 'Cuándo se marcó que el tercero ya cubrió el cheque.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 5a) Importar extracto: guarda las líneas nuevas y saltea las repetidas.
--     p_lineas: [{fecha, concepto, sucursal, importe, saldo, clave}] (importe con signo).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.importar_extracto_bbva(
  p_sociedad_id uuid, p_cuenta_id uuid, p_archivo text, p_lineas jsonb,
  p_saldo_final numeric, p_saldo_fecha date
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_cuenta public.cuentas_financieras%rowtype;
  v_extracto_id uuid;
  v_linea jsonb;
  v_importe numeric;
  v_insertadas integer := 0;
  v_repetidas integer := 0;
  v_creditos numeric := 0;
  v_debitos numeric := 0;
  v_desde date;
  v_hasta date;
begin
  if not public.lz_puede_operar_finanzas(p_sociedad_id) then raise exception 'No tenés permisos para cargar extractos en esta sociedad'; end if;
  select * into v_cuenta from public.cuentas_financieras where id = p_cuenta_id and sociedad_id = p_sociedad_id;
  if not found then raise exception 'La cuenta no existe en esta sociedad'; end if;
  if jsonb_typeof(p_lineas) <> 'array' then raise exception 'Líneas inválidas'; end if;

  select min((l->>'fecha')::date), max((l->>'fecha')::date) into v_desde, v_hasta from jsonb_array_elements(p_lineas) l;

  insert into public.extractos_bancarios (
    sociedad_id, banco, cuenta, moneda, periodo, fecha_upload, archivo,
    total_creditos, total_debitos, estado, created_by, cuenta_id
  ) values (
    p_sociedad_id, coalesce(v_cuenta.banco, 'Banco'), coalesce(v_cuenta.numero, v_cuenta.nombre), v_cuenta.moneda,
    coalesce(to_char(v_desde, 'YYYY-MM'), to_char(current_date, 'YYYY-MM')), now(), p_archivo,
    0, 0, 'parcial', auth.uid(), p_cuenta_id
  ) returning id into v_extracto_id;

  for v_linea in select value from jsonb_array_elements(p_lineas)
  loop
    v_importe := (v_linea->>'importe')::numeric;
    if v_importe is null or v_importe = 0 then continue; end if;
    insert into public.extracto_movimientos (
      extracto_id, fecha, descripcion, referencia, monto, tipo, estado, cuenta_id, saldo, sucursal, clave
    ) values (
      v_extracto_id, (v_linea->>'fecha')::date, v_linea->>'concepto', null, abs(v_importe),
      case when v_importe > 0 then 'credito' else 'debito' end::public.extracto_mov_tipo,
      'pendiente', p_cuenta_id, nullif(v_linea->>'saldo', '')::numeric, nullif(v_linea->>'sucursal', ''), v_linea->>'clave'
    )
    on conflict (cuenta_id, clave) where cuenta_id is not null and clave is not null do nothing;
    if found then
      v_insertadas := v_insertadas + 1;
      if v_importe > 0 then v_creditos := v_creditos + v_importe; else v_debitos := v_debitos - v_importe; end if;
    else
      v_repetidas := v_repetidas + 1;
    end if;
  end loop;

  if v_insertadas = 0 then
    delete from public.extractos_bancarios where id = v_extracto_id;
    v_extracto_id := null;
  else
    update public.extractos_bancarios set total_creditos = v_creditos, total_debitos = v_debitos where id = v_extracto_id;
  end if;

  -- El saldo del banco solo avanza (un Excel viejo no pisa uno más nuevo).
  if p_saldo_final is not null and p_saldo_fecha is not null
     and (v_cuenta.saldo_banco_fecha is null or p_saldo_fecha >= v_cuenta.saldo_banco_fecha) then
    update public.cuentas_financieras set saldo_banco = p_saldo_final, saldo_banco_fecha = p_saldo_fecha, updated_at = now()
      where id = p_cuenta_id;
  end if;

  return jsonb_build_object('extracto_id', v_extracto_id, 'insertadas', v_insertadas, 'repetidas', v_repetidas);
end;
$$;
revoke all on function public.importar_extracto_bbva(uuid, uuid, text, jsonb, numeric, date) from public, anon;
grant execute on function public.importar_extracto_bbva(uuid, uuid, text, jsonb, numeric, date) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5b) Aplicar cruces/clasificaciones. p_cruces: [{linea_id, clasificacion, subtipo, movimiento_id,
--     cheque_id, contra_cuenta_id, nota}]. clasificacion null = deshacer la línea.
--     - Con movimiento: queda conciliado y con la cuenta del extracto.
--     - Cheque emitido debitado / cheque recibido acreditado: pasa a "cobrado".
--     - Cheque devuelto: solo se enlaza (el rechazo se hace desde Cheques, que anula el cobro).
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
revoke all on function public.aplicar_cruces_extracto(uuid, jsonb) from public, anon;
grant execute on function public.aplicar_cruces_extracto(uuid, jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5c) Completar cheques emitidos desde la planilla o los Excel de eCheq.
--     p_cheques: [{numero, monto, fecha_emision, fecha_pago, beneficiario, estado, cubre_tercero, pagado_antes_corte}]
--     - Si el número ya existe: no lo toca (solo le pone cubre_tercero si no tenía). Excepción: si el banco
--       dice que se debitó antes del corte (pagado_antes_corte) y en el CRM sigue "a pagar", pasa a "cobrado"
--       (el extracto arranca en el corte y nunca lo cruzaría; si no, inflaría lo comprometido).
--     - solo_marcar: cheques viejos que solo sirven para esa marca; si no están en el CRM no se agregan.
--     - Si hay un cheque del CRM sin número real (CHQ-…) por el mismo monto y fecha de pago: le pone el número.
--     - Si no: lo agrega.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.completar_cheques_emitidos(p_sociedad_id uuid, p_cheques jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_c jsonb;
  v_numero text;
  v_existente uuid;
  v_sin_numero uuid;
  v_agregados integer := 0;
  v_numerados integer := 0;
  v_marcados integer := 0;
  v_ya integer := 0;
  v_pagados integer := 0;
begin
  if not public.lz_puede_operar_finanzas(p_sociedad_id) then raise exception 'No tenés permisos para cargar cheques en esta sociedad'; end if;
  if jsonb_typeof(p_cheques) <> 'array' then raise exception 'Cheques inválidos'; end if;

  for v_c in select value from jsonb_array_elements(p_cheques)
  loop
    v_numero := nullif(trim(v_c->>'numero'), '');
    if v_numero is null then continue; end if;

    select id into v_existente from public.echeqs
      where sociedad_id = p_sociedad_id and direccion = 'emitido'
        and ltrim(numero, '0') = ltrim(v_numero, '0')
      limit 1;

    if v_existente is null and coalesce((v_c->>'solo_marcar')::boolean, false) then
      continue;
    end if;

    if v_existente is null then
      select id into v_sin_numero from public.echeqs
        where sociedad_id = p_sociedad_id and direccion = 'emitido' and numero like 'CHQ-%'
          and round(monto::numeric, 2) = round((v_c->>'monto')::numeric, 2)
          and abs(fecha_pago - (v_c->>'fecha_pago')::date) <= 3
        order by abs(fecha_pago - (v_c->>'fecha_pago')::date)
        limit 1;
      if v_sin_numero is not null then
        update public.echeqs set numero = v_numero, tipo_cheque = 'echeq',
          cubre_tercero = coalesce(cubre_tercero, nullif(v_c->>'cubre_tercero', ''))
          where id = v_sin_numero;
        v_numerados := v_numerados + 1;
        v_existente := v_sin_numero;
      else
        insert into public.echeqs (
          direccion, tipo_cheque, numero, banco_emisor, monto, moneda, fecha_emision, fecha_pago, estado,
          destino_nombre, sociedad_id, user_id, observaciones, cubre_tercero
        ) values (
          'emitido', 'echeq', v_numero, 'BBVA', (v_c->>'monto')::numeric, 'ARS',
          nullif(v_c->>'fecha_emision', '')::date, (v_c->>'fecha_pago')::date,
          case upper(coalesce(v_c->>'estado', ''))
            when 'PAGADO' then 'cobrado'
            when 'ANULADO' then 'anulado'
            when 'RECHAZADO' then 'rechazado'
            else 'entregado' end,
          nullif(v_c->>'beneficiario', ''), p_sociedad_id, auth.uid(),
          'Cargado desde el listado del banco (' || to_char(current_date, 'DD/MM/YYYY') || ')',
          nullif(v_c->>'cubre_tercero', '')
        );
        v_agregados := v_agregados + 1;
        continue;
      end if;
    else
      v_ya := v_ya + 1;
      if coalesce((v_c->>'pagado_antes_corte')::boolean, false) then
        update public.echeqs set estado = 'cobrado'
          where id = v_existente and estado in ('pendiente', 'entregado');
        if found then v_pagados := v_pagados + 1; end if;
      end if;
    end if;

    if nullif(v_c->>'cubre_tercero', '') is not null then
      update public.echeqs set cubre_tercero = v_c->>'cubre_tercero'
        where id = v_existente and cubre_tercero is null;
      if found then v_marcados := v_marcados + 1; end if;
    end if;
  end loop;

  return jsonb_build_object('agregados', v_agregados, 'numerados', v_numerados, 'marcados', v_marcados, 'ya_estaban', v_ya, 'pagados', v_pagados);
end;
$$;
revoke all on function public.completar_cheques_emitidos(uuid, jsonb) from public, anon;
grant execute on function public.completar_cheques_emitidos(uuid, jsonb) to authenticated;

commit;
