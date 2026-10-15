-- 16/10/2026 — ADITIVA (no toca datos existentes). Finanzas con IA, Etapa A (docs/FINANZAS-IA.md).
-- Para deshacer: supabase/rollback/20261016120000_finanzas_bandeja.sql
--
-- Bandeja "Para confirmar": el sistema arma solo qué es cada línea del banco (cobro con sus facturas y retenciones,
-- pago de un gasto, impuesto, pase entre cuentas…) y una persona confirma con un clic.
--  1. finanzas_propuestas: lo que sugirió la IA para una línea (para no volver a pagarle a la IA) y los descartes.
--  2. finanzas_registro: bitácora de todo lo que se propuso y lo que hizo cada persona. Solo se agrega: nunca se edita ni se borra.
--  3. pagar_gasto_desde_extracto: pago de un gasto ya cargado (ej. sueldos de octubre) con la línea del banco, en un solo paso.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Propuestas guardadas (IA y descartes)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.finanzas_propuestas (
  id uuid primary key default gen_random_uuid(),
  sociedad_id uuid not null references public.sociedades(id) on delete restrict,
  linea_id uuid not null references public.extracto_movimientos(id) on delete cascade,
  origen text not null default 'ia' check (origen in ('ia', 'regla', 'mail', 'extracto')),
  -- {clasificacion, subtipo, nota, explicacion, ...}
  datos jsonb not null default '{}'::jsonb,
  confianza text check (confianza is null or confianza in ('alta', 'media', 'baja')),
  estado text not null default 'propuesta' check (estado in ('propuesta', 'confirmada', 'corregida', 'descartada')),
  motivo text,
  modelo text,
  created_at timestamptz not null default now(),
  resuelto_por uuid references public.profiles(id) on delete set null,
  resuelto_at timestamptz,
  unique (linea_id, origen)
);
create index if not exists finanzas_propuestas_sociedad_idx on public.finanzas_propuestas(sociedad_id, estado);

alter table public.finanzas_propuestas enable row level security;
revoke all on public.finanzas_propuestas from anon, authenticated;
grant select, insert, update on public.finanzas_propuestas to authenticated;
drop policy if exists finanzas_propuestas_rw on public.finanzas_propuestas;
create policy finanzas_propuestas_rw on public.finanzas_propuestas
  for all to authenticated
  using (public.lz_puede_operar_finanzas(sociedad_id))
  with check (public.lz_puede_operar_finanzas(sociedad_id));

comment on table public.finanzas_propuestas is 'Bandeja Para confirmar: sugerencias de la IA por línea del banco y descartes (Etapa A, 16/10/2026).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Registro (bitácora): solo se agrega
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.finanzas_registro (
  id bigint generated always as identity primary key,
  sociedad_id uuid not null references public.sociedades(id) on delete restrict,
  linea_id uuid references public.extracto_movimientos(id) on delete set null,
  -- confirmada / corregida / descartada / deshecha / ia_sugirio / regla_creada
  accion text not null,
  tipo text,                -- cobro, pago, gasto, impuesto, entre_cuentas…
  origen text,              -- mail, extracto, regla, ia, persona
  confianza text,
  resumen text,             -- una línea legible: "Corteva pagó $ 15.830.875,48 → 5 facturas"
  propuesta jsonb,          -- lo que propuso el sistema (con los datos usados: mail, línea, facturas…)
  resultado jsonb,          -- lo que quedó guardado (ids creados) o el motivo del descarte
  usuario_id uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists finanzas_registro_sociedad_idx on public.finanzas_registro(sociedad_id, created_at desc);
create index if not exists finanzas_registro_linea_idx on public.finanzas_registro(linea_id);

alter table public.finanzas_registro enable row level security;
revoke all on public.finanzas_registro from anon, authenticated;
grant select, insert on public.finanzas_registro to authenticated;
drop policy if exists finanzas_registro_select on public.finanzas_registro;
create policy finanzas_registro_select on public.finanzas_registro
  for select to authenticated using (public.lz_puede_operar_finanzas(sociedad_id));
drop policy if exists finanzas_registro_insert on public.finanzas_registro;
create policy finanzas_registro_insert on public.finanzas_registro
  for insert to authenticated with check (public.lz_puede_operar_finanzas(sociedad_id) and usuario_id = auth.uid());

comment on table public.finanzas_registro is 'Bitácora de la bandeja Para confirmar: qué propuso el sistema y qué hizo cada persona. Nunca se edita ni se borra.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Pagar un gasto ya cargado con una línea del banco (todo o nada)
--    Crea el pago del gasto (como la pantalla Gastos: movimiento "pago" con gasto_manual_id), en pesos por el importe
--    de la línea, en la cuenta de la línea, conciliado, y cruza la línea. Si el gasto ya tenía pago, solo cruza.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.pagar_gasto_desde_extracto(p_sociedad_id uuid, p_linea_id uuid, p_gasto_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_linea public.extracto_movimientos%rowtype;
  v_gasto public.gastos_manuales%rowtype;
  v_mov_id uuid;
  v_prov text;
begin
  if not public.lz_puede_operar_finanzas(p_sociedad_id) then raise exception 'No tenés permisos para conciliar en esta sociedad'; end if;

  select em.* into v_linea from public.extracto_movimientos em
    join public.extractos_bancarios eb on eb.id = em.extracto_id
    where em.id = p_linea_id and eb.sociedad_id = p_sociedad_id
    for update of em;
  if not found then raise exception 'Línea del extracto no disponible'; end if;
  if v_linea.tipo::text <> 'debito' then raise exception 'La línea no es un débito'; end if;
  if v_linea.match_movimiento_id is not null then raise exception 'La línea ya está cruzada con otro movimiento'; end if;

  select * into v_gasto from public.gastos_manuales where id = p_gasto_id and sociedad_id = p_sociedad_id for update;
  if not found then raise exception 'El gasto no existe en esta sociedad'; end if;

  select id into v_mov_id from public.movimientos
    where gasto_manual_id = p_gasto_id and sociedad_id = p_sociedad_id and not coalesce(anulado, false)
      and not exists (select 1 from public.extracto_movimientos x where x.match_movimiento_id = movimientos.id)
    order by created_at limit 1;

  if v_mov_id is null then
    select razon_social into v_prov from public.proveedores where id = v_gasto.proveedor_id;
    insert into public.movimientos (tipo, descripcion, monto, moneda, fecha, conciliado, conciliado_at, conciliado_por,
      gasto_manual_id, proveedor_id, sociedad_id, created_by, cuenta_id)
    values ('pago',
      'Gasto — ' || coalesce(v_gasto.categoria, '') || ' — ' || coalesce(v_gasto.descripcion, '') || coalesce(' (' || v_prov || ')', '')
        || case when coalesce(v_gasto.moneda, 'ARS') <> 'ARS' then ' | ' || v_gasto.moneda || ' ' || v_gasto.monto::text || ' pagados en pesos' else '' end,
      v_linea.monto, 'ARS', v_linea.fecha, true, now(), auth.uid(),
      p_gasto_id, v_gasto.proveedor_id, p_sociedad_id, auth.uid(), v_linea.cuenta_id)
    returning id into v_mov_id;
  end if;

  perform public.aplicar_cruces_extracto(p_sociedad_id, jsonb_build_array(jsonb_build_object(
    'linea_id', p_linea_id, 'clasificacion', 'pago', 'movimiento_id', v_mov_id,
    'nota', 'Gasto: ' || coalesce(v_gasto.descripcion, ''))));

  return jsonb_build_object('movimiento_id', v_mov_id);
end;
$$;
revoke all on function public.pagar_gasto_desde_extracto(uuid, uuid, uuid) from public, anon;
grant execute on function public.pagar_gasto_desde_extracto(uuid, uuid, uuid) to authenticated;

commit;
