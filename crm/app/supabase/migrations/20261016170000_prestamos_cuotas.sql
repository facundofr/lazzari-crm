-- 16/10/2026 — ADITIVA (no toca datos existentes). Préstamos con cuotas (Finanzas > Pagar > Créditos y préstamos).
-- Para deshacer: supabase/rollback/20261016170000_prestamos_cuotas.sql
--
-- "Créditos y préstamos" (lineas_credito) solo maneja cupos. Esto agrega préstamos con su tabla de cuotas:
-- fecha de pago, capital, interés, cargos, total y si está pagada. `paga_nombre` = quién paga las cuotas
-- (ej. Luis María Lazzari, Andrés Leguizamo) y `en_caja` = si las cuotas salen de la caja de la empresa
-- (false: se muestran aparte y no restan en la caja proyectada; pedido de Augusto 16/10/2026).
-- Al final se cargan los dos créditos BNA a nombre de Augusto Lazzari (datos de Augusto 12/10 y 16/10/2026).

begin;

create table if not exists public.prestamos (
  id uuid primary key default gen_random_uuid(),
  sociedad_id uuid not null references public.sociedades(id) on delete restrict,
  nombre text not null,                 -- "Crédito BNA 1"
  entidad text not null,                -- "Banco de la Nación Argentina"
  titular text,
  cuenta text,                          -- cuenta donde se debita la cuota
  cbu text,
  alias text,
  paga_nombre text,                     -- quién paga las cuotas
  en_caja boolean not null default false,
  sistema text,                         -- alemán / francés
  moneda text not null default 'ARS' check (moneda in ('ARS', 'USD')),
  capital_total numeric(14,2),
  estado text not null default 'activo' check (estado in ('activo', 'cancelado')),
  notas text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null default auth.uid()
);
create index if not exists prestamos_sociedad_idx on public.prestamos(sociedad_id, estado);

create table if not exists public.prestamo_cuotas (
  id uuid primary key default gen_random_uuid(),
  prestamo_id uuid not null references public.prestamos(id) on delete cascade,
  numero integer not null check (numero > 0),
  fecha_pago date not null,
  capital numeric(14,2),
  interes numeric(14,2),
  cargos numeric(14,2),
  total numeric(14,2) not null check (total >= 0),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'pagada', 'a_confirmar')),
  pagada_fecha date,
  notas text,
  unique (prestamo_id, numero)
);
create index if not exists prestamo_cuotas_fecha_idx on public.prestamo_cuotas(fecha_pago);

alter table public.prestamos enable row level security;
alter table public.prestamo_cuotas enable row level security;
revoke all on public.prestamos from anon, authenticated;
revoke all on public.prestamo_cuotas from anon, authenticated;
grant select, insert, update on public.prestamos to authenticated;
grant select, insert, update on public.prestamo_cuotas to authenticated;

drop policy if exists prestamos_rw on public.prestamos;
create policy prestamos_rw on public.prestamos
  for all to authenticated
  using (public.lz_puede_operar_finanzas(sociedad_id))
  with check (public.lz_puede_operar_finanzas(sociedad_id));

drop policy if exists prestamo_cuotas_rw on public.prestamo_cuotas;
create policy prestamo_cuotas_rw on public.prestamo_cuotas
  for all to authenticated
  using (exists (select 1 from public.prestamos p where p.id = prestamo_id and public.lz_puede_operar_finanzas(p.sociedad_id)))
  with check (exists (select 1 from public.prestamos p where p.id = prestamo_id and public.lz_puede_operar_finanzas(p.sociedad_id)));

comment on table public.prestamos is 'Préstamos con tabla de cuotas. en_caja=false: las cuotas las paga un tercero y no restan en la caja proyectada (16/10/2026).';
comment on table public.prestamo_cuotas is 'Cuotas de cada préstamo: fecha, capital, interés, cargos, total y estado (16/10/2026).';

-- ─────────────────────────────────────────────────────────────────────────────
-- Datos: créditos BNA a nombre de Augusto Lazzari (sociedad Lazzari). Ids fijos: si se corre dos veces no duplica.
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.prestamos (id, sociedad_id, nombre, entidad, titular, cuenta, cbu, alias, paga_nombre, en_caja, sistema, capital_total, notas, created_by)
values
  ('9b1a0c10-0001-4e00-9a00-000000000001', 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021', 'Crédito BNA 1', 'Banco de la Nación Argentina',
   'LAZZARI AUGUSTO (CUIT 20-37930912-8)', 'BNA CA $ 27003971709297', null, 'lazzariaugusto.bna', 'Luis María Lazzari', false, 'alemán', 3600000,
   'Lo paga Luis María Lazzari (papá), sin cuenta fija: cuando paga, Augusto avisa. 12 cuotas de capital $300.000, débito ~el 10. Al 16/10/2026 le faltan las 2 últimas vencidas (cuotas 3 y 4), según Augusto.', null),
  ('9b1a0c10-0001-4e00-9a00-000000000002', 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021', 'Crédito BNA 2', 'Banco de la Nación Argentina',
   'LAZZARI AUGUSTO (CUIT 20-37930912-8)', 'BNA CA $ 2700397170929', '1103975300397170000000', 'lazzariaugusto.bna', 'Andrés Leguizamo', false, 'alemán', 3336000,
   'Lo paga Andrés Leguizamo. 12 cuotas de capital $278.000. Al 16/10/2026 está al día (cuotas 1 a 4 pagadas), según Augusto.', null)
on conflict (id) do nothing;

insert into public.prestamo_cuotas (prestamo_id, numero, fecha_pago, capital, interes, cargos, total, estado, notas) values
  -- BNA 1 (solo se conocen capital y total con cargos)
  ('9b1a0c10-0001-4e00-9a00-000000000001',  1, '2026-07-13', 300000, null, null, 432874.52, 'pagada', null),
  ('9b1a0c10-0001-4e00-9a00-000000000001',  2, '2026-08-10', 300000, null, null, 385261.15, 'pagada', null),
  ('9b1a0c10-0001-4e00-9a00-000000000001',  3, '2026-09-10', 300000, null, null, 385814.80, 'pendiente', 'Vencida: Luis María no la pagó todavía (Augusto 16/10/2026)'),
  ('9b1a0c10-0001-4e00-9a00-000000000001',  4, '2026-10-09', 300000, null, null, 382216.11, 'pendiente', 'Vencida: Luis María no la pagó todavía (Augusto 16/10/2026)'),
  ('9b1a0c10-0001-4e00-9a00-000000000001',  5, '2026-11-10', 300000, null, null, 362008.11, 'pendiente', null),
  ('9b1a0c10-0001-4e00-9a00-000000000001',  6, '2026-12-10', 300000, null, null, 358132.60, 'pendiente', null),
  ('9b1a0c10-0001-4e00-9a00-000000000001',  7, '2027-01-08', 300000, null, null, 353149.80, 'pendiente', null),
  ('9b1a0c10-0001-4e00-9a00-000000000001',  8, '2027-02-10', 300000, null, null, 341523.29, 'pendiente', null),
  ('9b1a0c10-0001-4e00-9a00-000000000001',  9, '2027-03-10', 300000, null, null, 331004.05, 'pendiente', null),
  ('9b1a0c10-0001-4e00-9a00-000000000001', 10, '2027-04-08', 300000, null, null, 327405.36, 'pendiente', null),
  ('9b1a0c10-0001-4e00-9a00-000000000001', 11, '2027-05-10', 300000, null, null, 315502.04, 'pendiente', null),
  ('9b1a0c10-0001-4e00-9a00-000000000001', 12, '2027-06-10', 300000, null, null, 308581.48, 'pendiente', null),
  -- BNA 2 (tabla de Augusto 16/10/2026: capital, interés, total cargos y cuota total mensual)
  ('9b1a0c10-0001-4e00-9a00-000000000002',  1, '2026-07-13', 278000, 99805.81, 20246.32, 398052.13, 'pagada', null),
  ('9b1a0c10-0001-4e00-9a00-000000000002',  2, '2026-08-10', 278000, 65684.16, 13324.51, 357008.67, 'pagada', null),
  ('9b1a0c10-0001-4e00-9a00-000000000002',  3, '2026-09-10', 278000, 66110.68, 13411.03, 357521.71, 'pagada', null),
  ('9b1a0c10-0001-4e00-9a00-000000000002',  4, '2026-10-09', 278000, 63338.30, 12848.62, 354186.92, 'pagada', null),
  ('9b1a0c10-0001-4e00-9a00-000000000002',  5, '2026-11-10', 278000, 47770.30,  9690.54, 335460.84, 'pendiente', null),
  ('9b1a0c10-0001-4e00-9a00-000000000002',  6, '2026-12-10', 278000, 44784.66,  9084.89, 331869.55, 'pendiente', null),
  ('9b1a0c10-0001-4e00-9a00-000000000002',  7, '2027-01-08', 278000, 40945.97,  8306.19, 327252.16, 'pendiente', null),
  ('9b1a0c10-0001-4e00-9a00-000000000002',  8, '2027-02-10', 278000, 31989.04,  6489.21, 316478.25, 'pendiente', null),
  ('9b1a0c10-0001-4e00-9a00-000000000002',  9, '2027-03-10', 278000, 23885.15,  4845.28, 306730.43, 'pendiente', null),
  ('9b1a0c10-0001-4e00-9a00-000000000002', 10, '2027-04-08', 278000, 21112.77,  4282.87, 303395.64, 'pendiente', null),
  ('9b1a0c10-0001-4e00-9a00-000000000002', 11, '2027-05-10', 278000, 11942.58,  2422.63, 292365.21, 'pendiente', null),
  ('9b1a0c10-0001-4e00-9a00-000000000002', 12, '2027-06-10', 278000,  6611.07,  1341.10, 285952.17, 'pendiente', null)
on conflict (prestamo_id, numero) do nothing;

commit;
