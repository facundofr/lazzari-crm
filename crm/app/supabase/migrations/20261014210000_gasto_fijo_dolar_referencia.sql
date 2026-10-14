-- Dólar de referencia de un gasto fijo en US$ (ej. alquiler): vive en Finanzas > Gastos fijos y lo lee el recuadro del Dashboard.
-- Solo agrega una columna vacía. Antes el dólar se guardaba solo en el navegador de cada compu.
begin;
alter table public.gastos_fijos add column if not exists dolar_referencia numeric(14,2) check (dolar_referencia is null or dolar_referencia > 0);
commit;
