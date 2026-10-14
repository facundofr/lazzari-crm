-- Vuelta atrás: deja el alquiler sin dólar de referencia.
begin;
update public.gastos_fijos set dolar_referencia = null where id = '6a1f0c10-0001-4e00-9a00-000000000002';
commit;
