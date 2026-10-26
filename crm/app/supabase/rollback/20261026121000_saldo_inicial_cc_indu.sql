-- Vuelta atrás de 20261026121000_saldo_inicial_cc_indu.sql
-- Vuelve el saldo inicial de la BBVA CC INDU LAZZARI a $ 4.797,36.
begin;

update public.cuentas_financieras set saldo_inicial = 4797.36, updated_at = now()
  where id = '921efbef-55b6-427d-83da-6336c8dd8157' and saldo_inicial = 4997.54;

commit;
