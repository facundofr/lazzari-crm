-- Vuelta atrás de 20261014110000_gastos_fijos_pagos_pendientes.sql.
-- Se pierde: a qué gasto fijo corresponde cada gasto, el día de vencimiento y la marca SICORE.
begin;
alter table public.gastos_fijos drop column if exists calculo;
alter table public.gastos_fijos drop column if exists dia_vencimiento;
drop index if exists public.gastos_manuales_gasto_fijo_idx;
alter table public.gastos_manuales drop column if exists gasto_fijo_id;
commit;
