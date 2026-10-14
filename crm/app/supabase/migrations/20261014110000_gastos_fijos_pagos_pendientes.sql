-- Gastos fijos que esperan su pago del mes (OK de Augusto 14/10/2026). Solo agrega.
-- (Pendientes: se usa la tabla "pendientes" que ya existe, no hace falta otra.)
begin;
-- Un gasto (pestaña Gastos: VEP, débito, etc.) puede ser el pago de un gasto fijo → avisa si falta pagarlo en el mes.
alter table public.gastos_manuales add column if not exists gasto_fijo_id uuid references public.gastos_fijos(id) on delete set null;
create index if not exists gastos_manuales_gasto_fijo_idx on public.gastos_manuales(gasto_fijo_id);
-- Día del mes en que vence (para el aviso) y monto automático (SICORE = retenciones del mes).
alter table public.gastos_fijos add column if not exists dia_vencimiento smallint check (dia_vencimiento between 1 and 31);
alter table public.gastos_fijos add column if not exists calculo text check (calculo in ('sicore'));
commit;
