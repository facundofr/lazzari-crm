-- Objetivo de ventas mensual de Lazzari — 14/10/2026, pedido de Augusto ("ponelo vos").
-- 1) La tabla objetivos no tenía sociedad_id y la pantalla Finanzas > Objetivos filtra por esa columna (daba error 400 y la tabla quedó vacía).
--    Se agrega la columna (opcional: un objetivo sin sociedad vale para todas).
-- 2) Se carga el objetivo: $120.000.000 por mes, neto de IVA, para Lazzari, vigente desde octubre 2026 hasta nuevo aviso.
-- Aditiva: 1 columna y 1 fila. Vuelta atrás: supabase/rollback/20261014180000_objetivo_ventas_mensual.sql
begin;

alter table public.objetivos
  add column if not exists sociedad_id uuid references public.sociedades(id) on delete cascade;
create index if not exists objetivos_sociedad_idx on public.objetivos(sociedad_id);

insert into public.objetivos (nombre, tipo, monto_target, moneda, periodo_inicio, periodo_fin, activo, notas, sociedad_id)
select 'Ventas del mes (neto, sin IVA)', 'ventas', 120000000, 'ARS', date '2026-10-01', date '2099-12-31', true,
       'Objetivo mensual: $120.000.000 + IVA (se compara contra la venta neta). Cargado el 14/10/2026.',
       'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021'
where not exists (
  select 1 from public.objetivos
  where sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and nombre = 'Ventas del mes (neto, sin IVA)'
);

commit;
