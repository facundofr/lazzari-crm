-- Vuelta atrás de 20261011170000_cuentas_financieras.sql
-- Saca el trigger de cuenta sugerida, las columnas cuenta_id y la tabla de cuentas.
-- ⚠️ Se pierden las cuentas cargadas y la cuenta asignada a cada movimiento (los movimientos en sí no se tocan).
begin;

drop trigger if exists movimientos_cuenta_sugerida on public.movimientos;
drop function if exists public.lz_cuenta_sugerida_movimiento();

drop index if exists public.movimientos_cuenta_idx;
alter table public.movimientos drop column if exists cuenta_id;

drop index if exists public.extractos_bancarios_cuenta_idx;
alter table public.extractos_bancarios drop column if exists cuenta_id;

drop trigger if exists cuentas_financieras_updated_at on public.cuentas_financieras;
drop function if exists public.lz_cuentas_financieras_updated_at();
drop table if exists public.cuentas_financieras;

commit;
