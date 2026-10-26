-- Dato B de la revisión de Finanzas (26/10/2026, chat Para confirmar BBVA): saldo inicial de la BBVA CC INDU LAZZARI (091-318933/7).
-- El saldo al 31/08 que se cargó ($ 4.797,36) es el de DESPUÉS de las comisiones del 09 y 10/09 ($ 200,18), que también están como líneas del banco:
-- se contaban dos veces. El correcto es $ 4.997,54 (antes de la primera línea). Con eso, saldo inicial + líneas = $ 53.297,36 = saldo del banco.
-- Las pantallas usan el saldo del banco, así que lo que se ve no cambia. Si el saldo no es el esperado, no cambia nada (tira error).
-- Vuelta atrás: supabase/rollback/20261026121000_saldo_inicial_cc_indu.sql
begin;

do $$
declare
  v_n integer;
begin
  update public.cuentas_financieras set saldo_inicial = 4997.54, updated_at = now()
    where id = '921efbef-55b6-427d-83da-6336c8dd8157' and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021'
      and numero = '091-318933/7' and saldo_inicial = 4797.36;
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'La CC INDU no tiene el saldo inicial esperado ($ 4.797,36): no se cambia nada'; end if;
end $$;

commit;
