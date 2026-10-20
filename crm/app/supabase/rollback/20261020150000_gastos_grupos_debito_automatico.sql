-- Vuelta atrás de 20261020150000_gastos_grupos_debito_automatico.sql
-- Saca la función y las columnas nuevas (grupo y medio_pago de los fijos). No toca categorías, montos ni pagos.
-- OJO: los gastos que la función ya haya cargado solos (notas "[débito automático cargado solo]") NO se borran con esto:
-- si hace falta sacarlos, se borran desde Gastos (Deshacer), que también anula su pago.
begin;
drop function if exists public.cargar_debitos_automaticos(uuid);
alter table public.gastos_manuales drop constraint if exists gastos_manuales_grupo_check;
alter table public.gastos_fijos drop constraint if exists gastos_fijos_grupo_check;
alter table public.gastos_manuales drop column if exists grupo;
alter table public.gastos_fijos drop column if exists grupo;
alter table public.gastos_fijos drop column if exists medio_pago;
commit;
