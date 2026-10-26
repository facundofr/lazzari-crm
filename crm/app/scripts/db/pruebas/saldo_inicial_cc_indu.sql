-- Prueba de 20261026121000_saldo_inicial_cc_indu.sql (se corre con --probar: muestra resultados y DESHACE todo).
with c as (
  select id, saldo_inicial, saldo_banco, saldo_banco_fecha from public.cuentas_financieras where id = '921efbef-55b6-427d-83da-6336c8dd8157'
), l as (
  select coalesce(sum(case when x.tipo::text = 'credito' then x.monto else -x.monto end), 0) as neto, count(*) as n
  from public.extracto_movimientos x join c on x.cuenta_id = c.id
)
select 'CC INDU: saldo inicial al 31/08' as control, to_char(saldo_inicial, 'FM999G999G990D00') as valor, 'esperado 4.997,54 (antes 4.797,36)' as nota from c
union all select 'CC INDU: líneas del banco (neto)', to_char(neto, 'FM999G999G990D00') || ' en ' || n || ' líneas', 'esperado 48.299,82 en 6 líneas' from l
union all select 'CC INDU: saldo inicial + líneas', to_char(saldo_inicial + neto, 'FM999G999G990D00'), 'esperado 53.297,36' from c, l
union all select 'CC INDU: saldo según el banco', to_char(saldo_banco, 'FM999G999G990D00') || ' al ' || to_char(saldo_banco_fecha, 'DD/MM'), 'esperado 53.297,36 al 15/10 (no cambia)' from c
union all select 'CC INDU: diferencia', to_char(saldo_inicial + neto - saldo_banco, 'FM999G999G990D00'), 'esperado 0,00 (antes -200,18)' from c, l;
