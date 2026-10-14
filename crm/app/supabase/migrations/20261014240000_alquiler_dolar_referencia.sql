-- Dólar de referencia del alquiler (US$ 800, Lazzari): $1.545 (blue), el que Augusto tenía cargado en el recuadro del Dashboard (localStorage lz-dolar-fijos).
begin;
update public.gastos_fijos set dolar_referencia = 1545
 where id = '6a1f0c10-0001-4e00-9a00-000000000002' and dolar_referencia is null;
commit;
