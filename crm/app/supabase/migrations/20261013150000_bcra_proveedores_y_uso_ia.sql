-- 13/10/2026 — ADITIVA (no toca datos existentes).
-- Para deshacer: supabase/rollback/20261013150000_bcra_proveedores_y_uso_ia.sql
--
--  1. proveedor_bcra_informes: informe BCRA (Central de Deudores) por proveedor, mes a mes.
--     Igual que cliente_bcra_informes. Solo informa: nunca frena una compra ni un pago.
--  2. ia_uso: una fila por cada llamada a la IA del CRM (para el contador del mes en Configuración).

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Informe BCRA por proveedor
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.proveedor_bcra_informes (
  id uuid primary key default gen_random_uuid(),
  sociedad_id uuid not null references public.sociedades(id),
  proveedor_id uuid not null references public.proveedores(id) on delete cascade,
  cuit text not null,
  mes text not null,                          -- AAAA-MM en que se consultó
  periodo_bcra text,
  denominacion text,
  peor_situacion integer,
  deuda_total numeric(20,2) not null default 0,  -- en miles de pesos, como informa el BCRA
  entidades integer not null default 0,
  cheques_rechazados integer not null default 0,
  cheques_sin_pagar integer not null default 0,
  monto_cheques_sin_pagar numeric(20,2) not null default 0,
  proceso_judicial boolean not null default false,
  semaforo text not null default 'gris' check (semaforo in ('verde', 'amarillo', 'rojo', 'gris')),
  historial jsonb,
  data jsonb,
  error text,
  consultado_at timestamptz not null default now(),
  consultado_by uuid references public.profiles(id) default auth.uid(),
  unique (proveedor_id, mes)
);
create index if not exists proveedor_bcra_sociedad_idx on public.proveedor_bcra_informes (sociedad_id, mes);

alter table public.proveedor_bcra_informes enable row level security;
drop policy if exists proveedor_bcra_rw on public.proveedor_bcra_informes;
create policy proveedor_bcra_rw on public.proveedor_bcra_informes for all to authenticated
  using (public.lz_es_de_sociedad(sociedad_id))
  with check (public.lz_es_de_sociedad(sociedad_id));
grant select, insert, update, delete on public.proveedor_bcra_informes to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Uso de IA
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.ia_uso (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  funcion text not null,                      -- para qué se usó (ej. 'factura_compra', 'cobro', 'oc')
  modelo text,
  tokens_entrada integer not null default 0,
  tokens_salida integer not null default 0,
  user_id uuid default auth.uid()
);
create index if not exists ia_uso_fecha_idx on public.ia_uso (created_at);

alter table public.ia_uso enable row level security;
drop policy if exists ia_uso_insert on public.ia_uso;
create policy ia_uso_insert on public.ia_uso for insert to authenticated with check (true);
drop policy if exists ia_uso_select on public.ia_uso;
create policy ia_uso_select on public.ia_uso for select to authenticated using (true);
grant select, insert on public.ia_uso to authenticated;

commit;
