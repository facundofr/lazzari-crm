-- Vuelta atrás de 20261014210000_gasto_fijo_dolar_referencia.sql: saca la columna (se pierde solo el dólar cargado en ella).
begin;
alter table public.gastos_fijos drop column if exists dolar_referencia;
commit;
