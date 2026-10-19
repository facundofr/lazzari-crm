-- 19/10/2026 — ADITIVA (no borra ni cambia datos existentes). Finanzas Lazza, Tanda 3: Bancos.
-- Para deshacer: supabase/rollback/20261019120000_finanzas_lazza_bancos.sql
--
-- 1) prestamos.sentido: 'debo' (lo que debo, como los BNA) o 'me_deben' (lo que me deben). Los existentes quedan 'debo'.
--    Los préstamos sin cuotas fijas (familia) anotan cada pago como una cuota 'pagada' (fecha + monto) y "falta" = capital − pagado.
-- 2) Préstamos que pasó Augusto el 18/10/2026 (sociedad Lazzari, ids fijos: si se corre dos veces no duplica):
--    Lo que debo: Cecilia Alvarez US$ 25.000 y José Alvarez US$ 18.500 (US$ 8.500 los paga Andrés Leguizamo vía Augusto), sin fechas.
--    Lo que me deben: Andrés Leguizamo US$ 8.500 (pagó 0 al 18/10/2026).
-- 3) Cuenta BAVSA en US$ con saldo US$ 10.000 (el del préstamo de Cecilia); en $ "a definir" hasta que Augusto vea si debe o tiene a favor.
-- 4) Tabla tarjeta_resumenes: un resumen por tarjeta y por cierre (cierre, vencimiento, total $/US$, mínimo, personal vs empresa).
--    Se carga subiendo el PDF del resumen: la IA lo lee y Augusto revisa antes de guardar.
begin;

-- 1) Sentido del préstamo
alter table public.prestamos add column if not exists sentido text not null default 'debo';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'prestamos_sentido_check') then
    alter table public.prestamos add constraint prestamos_sentido_check check (sentido in ('debo', 'me_deben'));
  end if;
end $$;
comment on column public.prestamos.sentido is 'debo = préstamo que tengo que devolver; me_deben = préstamo que hice y me tienen que devolver (19/10/2026).';

-- 2) Préstamos de la familia (sin cuotas fijas)
insert into public.prestamos (id, sociedad_id, nombre, entidad, titular, paga_nombre, en_caja, moneda, capital_total, sentido, notas, created_by)
values
  ('9b1a0c10-0001-4e00-9a00-000000000003', 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021', 'Préstamo Cecilia Alvarez', 'Cecilia Alvarez', 'Augusto Lazzari', null, false, 'USD', 25000, 'debo',
   'Sin fecha de devolución (Augusto 18/10/2026). El saldo de US$ 10.000 está en BAVSA.', null),
  ('9b1a0c10-0001-4e00-9a00-000000000004', 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021', 'Préstamo José Alvarez', 'José Alvarez', 'Augusto Lazzari', null, false, 'USD', 18500, 'debo',
   'Sin fecha de devolución (Augusto 18/10/2026). US$ 8.500 los paga Andrés Leguizamo vía Augusto.', null),
  ('9b1a0c10-0001-4e00-9a00-000000000005', 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021', 'Préstamo a Andrés Leguizamo', 'Andrés Leguizamo', 'Augusto Lazzari', 'Andrés Leguizamo', false, 'USD', 8500, 'me_deben',
   'Su parte del préstamo de José Alvarez: lo paga vía Augusto. Pagó 0 al 18/10/2026.', null)
on conflict (id) do nothing;

-- 3) BAVSA (US$). Saldo al 18/10/2026 = US$ 10.000 (Augusto).
insert into public.cuentas_financieras (id, sociedad_id, nombre, tipo, banco, moneda, fecha_corte, saldo_inicial, saldo_banco, saldo_banco_fecha, uso, activa, orden, observaciones)
values ('6c0a1b20-0001-4e00-9a00-000000000001', 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021', 'BAVSA', 'fci', 'BAVSA', 'USD', date '2026-10-18', 10000, 10000, date '2026-10-18', 'trabajo', true, 90,
        'Saldo del préstamo de Cecilia Alvarez. En pesos: a definir (Augusto ve si debe o tiene a favor).')
on conflict (id) do nothing;

-- 4) Resúmenes de tarjeta
create table if not exists public.tarjeta_resumenes (
  id uuid primary key default gen_random_uuid(),
  sociedad_id uuid not null references public.sociedades(id) on delete restrict,
  cuenta_id uuid not null references public.cuentas_financieras(id) on delete restrict,
  cierre date not null,
  vencimiento date,
  total_ars numeric(16,2) not null default 0,
  total_usd numeric(16,2) not null default 0,
  minimo_ars numeric(16,2),
  -- Parte personal (Master: gastos personales vs empresa). Empresa = total − personal.
  personal_ars numeric(16,2) not null default 0,
  personal_usd numeric(16,2) not null default 0,
  archivo_url text,
  archivo_nombre text,
  notas text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  unique (cuenta_id, cierre)
);
create index if not exists tarjeta_resumenes_sociedad_idx on public.tarjeta_resumenes(sociedad_id, cierre desc);

alter table public.tarjeta_resumenes enable row level security;
revoke all on public.tarjeta_resumenes from anon, authenticated;
grant select, insert, update on public.tarjeta_resumenes to authenticated;
drop policy if exists tarjeta_resumenes_rw on public.tarjeta_resumenes;
create policy tarjeta_resumenes_rw on public.tarjeta_resumenes
  for all to authenticated
  using (public.lz_puede_operar_finanzas(sociedad_id))
  with check (public.lz_puede_operar_finanzas(sociedad_id));
comment on table public.tarjeta_resumenes is 'Resumen mensual de cada tarjeta: cierre, vencimiento, total $/US$, mínimo y parte personal (Finanzas Lazza > Bancos, 19/10/2026).';

commit;
