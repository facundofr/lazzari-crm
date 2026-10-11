-- Cuentas y extractos, etapa 1: cuentas financieras con saldo al corte.
--
-- 1) Tabla nueva cuentas_financieras (bancos, FCI, tarjetas, efectivo y las dos cuentas automáticas de cheques).
-- 2) Columna cuenta_id (opcional) en movimientos y en extractos_bancarios. Lo ya cargado queda igual (sin cuenta).
-- 3) Cuenta sugerida para lo nuevo: al insertar un cobro/pago sin cuenta, se le pone la predeterminada según el medio.
--    Si algo falla, el movimiento se guarda igual sin cuenta (nunca frena).
-- 4) Carga de las cuentas de Lazzari con los saldos al 31/08/2026 (sacados de los extractos BBVA y la planilla de caja).
--
-- Cambios aditivos. Vuelta atrás: supabase/rollback/20261011170000_cuentas_financieras.sql
begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Cuentas
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.cuentas_financieras (
  id uuid primary key default gen_random_uuid(),
  sociedad_id uuid not null references public.sociedades(id) on delete restrict,
  nombre text not null,
  tipo text not null check (tipo in (
    'cuenta_corriente', 'caja_ahorro', 'fci', 'tarjeta_credito', 'efectivo', 'cheques_cartera', 'cheques_emitidos'
  )),
  banco text,
  numero text,
  moneda text not null default 'ARS' check (moneda in ('ARS', 'USD')),
  -- Tarjetas: el resumen trae pesos y dólares.
  admite_usd boolean not null default false,
  fecha_corte date not null default date '2026-08-31',
  -- Saldo al cierre de fecha_corte. Null = falta cargarlo (las tarjetas y las de cheques no lo usan).
  saldo_inicial numeric(16, 2),
  -- Descubierto acordado (cuentas corrientes).
  acuerdo numeric(16, 2) not null default 0,
  -- Tarjetas: cuenta desde la que se paga el resumen.
  se_paga_desde uuid references public.cuentas_financieras(id) on delete set null,
  uso text not null default 'trabajo' check (uso in ('trabajo', 'mixto')),
  -- La que se sugiere para los movimientos nuevos de su tipo y moneda.
  predeterminada boolean not null default false,
  activa boolean not null default true,
  orden integer not null default 0,
  observaciones text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);

create index if not exists cuentas_financieras_sociedad_idx on public.cuentas_financieras(sociedad_id, orden);
create unique index if not exists cuentas_financieras_numero_unique
  on public.cuentas_financieras(sociedad_id, tipo, numero) where numero is not null;

alter table public.cuentas_financieras enable row level security;
revoke all on public.cuentas_financieras from anon, authenticated;
grant select, insert, update on public.cuentas_financieras to authenticated;

drop policy if exists cuentas_financieras_rw on public.cuentas_financieras;
create policy cuentas_financieras_rw on public.cuentas_financieras
  for all to authenticated
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('super_admin', 'admin', 'administrativo'))
    and (
      not exists (select 1 from public.user_sociedades us where us.user_id = auth.uid())
      or exists (select 1 from public.user_sociedades us where us.user_id = auth.uid() and us.sociedad_id = cuentas_financieras.sociedad_id)
    )
  )
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('super_admin', 'admin', 'administrativo'))
    and (
      not exists (select 1 from public.user_sociedades us where us.user_id = auth.uid())
      or exists (select 1 from public.user_sociedades us where us.user_id = auth.uid() and us.sociedad_id = cuentas_financieras.sociedad_id)
    )
  );

create or replace function public.lz_cuentas_financieras_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists cuentas_financieras_updated_at on public.cuentas_financieras;
create trigger cuentas_financieras_updated_at before update on public.cuentas_financieras
  for each row execute function public.lz_cuentas_financieras_updated_at();

comment on table public.cuentas_financieras is
  'Cuentas de Finanzas (bancos, FCI, tarjetas, efectivo, cheques). Saldo = saldo_inicial al cierre de fecha_corte + movimientos con fecha posterior.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) cuenta_id en movimientos y extractos
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.movimientos add column if not exists cuenta_id uuid
  references public.cuentas_financieras(id) on delete set null;
create index if not exists movimientos_cuenta_idx on public.movimientos(cuenta_id, fecha) where cuenta_id is not null;

alter table public.extractos_bancarios add column if not exists cuenta_id uuid
  references public.cuentas_financieras(id) on delete set null;
create index if not exists extractos_bancarios_cuenta_idx on public.extractos_bancarios(cuenta_id) where cuenta_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Cuenta sugerida para los movimientos nuevos
-- ─────────────────────────────────────────────────────────────────────────────
-- Regla (la misma que lib/saldo-cuentas.ts → grupoCuentaSugerido):
--   cheque_recibido, o echeq de cliente        → cheques en cartera
--   cheque_emitido, o echeq a proveedor        → cheques emitidos a pagar
--   efectivo                                   → efectivo
--   tarjeta a proveedor                        → tarjeta de crédito
--   transferencia, depósito, cobro, pago,
--   tarjeta de cliente                         → banco (cuenta corriente o caja de ahorro)
--   retenciones, ajustes, NC, anulados         → sin cuenta
create or replace function public.lz_cuenta_sugerida_movimiento()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v jsonb;
  v_tipo text;
  v_cliente boolean;
  v_proveedor boolean;
  v_grupo text;
  v_cuenta uuid;
begin
  if new.cuenta_id is not null then return new; end if;
  begin
    v := to_jsonb(new);
    if coalesce((v->>'anulado')::boolean, false)
       or v->>'sociedad_id' is null
       or v->>'nota_credito_compra_id' is not null
       or coalesce(v->>'descripcion', '') ~* '^\s*\[Ajuste manual\]' then
      return new;
    end if;

    v_tipo := coalesce(v->>'tipo', '');
    v_cliente := v->>'cliente_id' is not null;
    v_proveedor := v->>'proveedor_id' is not null;

    v_grupo := case
      when v_tipo like 'retencion_%' or v_tipo = 'ajuste' then null
      when v_tipo = 'cheque_recibido' then 'cheques_cartera'
      when v_tipo = 'cheque_emitido' then 'cheques_emitidos'
      when v_tipo = 'echeq' then case when v_proveedor and not v_cliente then 'cheques_emitidos' else 'cheques_cartera' end
      when v_tipo = 'efectivo' then 'efectivo'
      when v_tipo = 'tarjeta' then case when v_proveedor and not v_cliente then 'tarjeta_credito' else 'banco' end
      when v_tipo in ('transferencia', 'deposito', 'cobro', 'pago') then 'banco'
      else null
    end;
    if v_grupo is null then return new; end if;

    select c.id into v_cuenta
      from public.cuentas_financieras c
     where c.sociedad_id = (v->>'sociedad_id')::uuid
       and c.activa
       and c.predeterminada
       and (case when v_grupo = 'banco' then c.tipo in ('cuenta_corriente', 'caja_ahorro') else c.tipo = v_grupo end)
       and (c.tipo in ('cheques_cartera', 'cheques_emitidos', 'tarjeta_credito')
            or c.moneda = coalesce(v->>'moneda', 'ARS'))
     order by c.orden, c.created_at
     limit 1;

    new.cuenta_id := v_cuenta;
  exception when others then
    -- Nunca frenar un cobro o un pago por esto.
    new.cuenta_id := null;
  end;
  return new;
end $$;

drop trigger if exists movimientos_cuenta_sugerida on public.movimientos;
create trigger movimientos_cuenta_sugerida before insert on public.movimientos
  for each row execute function public.lz_cuenta_sugerida_movimiento();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Cuentas de Lazzari al 31/08/2026
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  s constant uuid := 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021';
  v_cc uuid;
begin
  if exists (select 1 from public.cuentas_financieras where sociedad_id = s) then
    raise notice 'Lazzari ya tiene cuentas cargadas: no se agregan.';
    return;
  end if;

  insert into public.cuentas_financieras (sociedad_id, nombre, tipo, banco, numero, moneda, saldo_inicial, acuerdo, predeterminada, orden, observaciones)
  values (s, 'BBVA CC EPP LAZZARI', 'cuenta_corriente', 'BBVA', '091-312483/1', 'ARS', 10829781.65, 1500000, true, 10,
          'Cuenta principal. Debita las tarjetas. Saldo al 31/08 del Excel de movimientos (último: pago cheque 24hs 90017062).')
  returning id into v_cc;

  insert into public.cuentas_financieras (sociedad_id, nombre, tipo, banco, numero, moneda, admite_usd, saldo_inicial, acuerdo, se_paga_desde, uso, predeterminada, orden, observaciones)
  values
    (s, 'BBVA CC INDU LAZZARI', 'cuenta_corriente', 'BBVA', '091-318933/7', 'ARS', false, 4797.36, 0, null, 'trabajo', false, 20,
     'Sin movimientos en el período.'),
    (s, 'BBVA Caja de ahorro $', 'caja_ahorro', 'BBVA', '091-339549/3', 'ARS', false, 300440.53, 0, null, 'trabajo', false, 30,
     'Saldo al 31/08 del Excel de movimientos.'),
    (s, 'BBVA Caja de ahorro U$S', 'caja_ahorro', 'BBVA', '091-314103/6', 'USD', false, 14.62, 0, null, 'trabajo', true, 40,
     'Saldo al corte tomado del saldo al 11/10 (sin extracto de agosto).'),
    (s, 'BBVA FCI Money Market Pesos', 'fci', 'BBVA', '91-565772/5', 'ARS', false, 97564382.92, 0, null, 'trabajo', true, 50,
     '551.950,26 cuotapartes al 31/08 x valor aprox. 176,763 (entre 27/08 y 01/09). La diferencia con el valor real es rendimiento.'),
    (s, 'BBVA Visa Signature ·1582', 'tarjeta_credito', 'BBVA', '0996722533', 'ARS', true, null, 0, v_cc, 'trabajo', true, 60,
     'Compras de Mercado Libre. Deuda al corte (resumen cierre 01/09): $9.792.257,37 + U$S 148,82. Va por resúmenes (etapa 3).'),
    (s, 'BBVA Mastercard Black ·4775', 'tarjeta_credito', 'BBVA', '1268315983', 'ARS', true, null, 0, v_cc, 'mixto', false, 70,
     'Hoy con gastos personales. Deuda al corte (resumen cierre 01/09): $4.402.026,27 + U$S 4.389,17. Va por resúmenes (etapa 3).'),
    (s, 'Efectivo', 'efectivo', null, null, 'ARS', false, 33520, 0, null, 'trabajo', true, 80,
     'Arranque de caja 08/09 de la planilla de Augusto (sin contar Útil).'),
    (s, 'Cheques en cartera', 'cheques_cartera', null, null, 'ARS', false, null, 0, null, 'trabajo', true, 90,
     'Automática: se calcula con los cheques recibidos en cartera.'),
    (s, 'Cheques emitidos a pagar', 'cheques_emitidos', null, null, 'ARS', false, null, 0, null, 'trabajo', true, 100,
     'Automática: cheques y eCheqs propios todavía no debitados.');
end $$;

commit;
