-- Vuelta atrás de 20261027120000_atar_vep_autonomos_2310.sql
-- Desata la línea del banco del 23/10 ($ 107.789,20, Autónomos) de su gasto: la línea queda confirmada como impuesto de ARCA
-- sin atar (con la nota de antes) y el pago del gasto vuelve a "sin conciliar", como estaban antes.
begin;

update public.extracto_movimientos set
    match_movimiento_id = null,
    nota = 'Impuesto debitado por el banco (PAGO SERVICI 17779347 OP3636): $ 107.789,20.'
  where id = '2ddeba5c-d0a1-45a3-ba00-747e3ff7cc8c' and match_movimiento_id = '4df2d89c-2232-4374-b67e-e1e3dd4796c9';

update public.movimientos set conciliado = false, conciliado_at = null, conciliado_por = null
  where id = '4df2d89c-2232-4374-b67e-e1e3dd4796c9'
    and not exists (select 1 from public.extracto_movimientos where match_movimiento_id = '4df2d89c-2232-4374-b67e-e1e3dd4796c9');

commit;
