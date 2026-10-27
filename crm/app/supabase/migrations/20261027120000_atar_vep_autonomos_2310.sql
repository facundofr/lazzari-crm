-- Arreglo 18 de la auditoría de Impuestos (27/10/2026, Augusto aprobó el punto 5): la línea del banco del 23/10
-- "PAGO SERVICI 17779347 OP3636 #137" ($ 107.789,20, BBVA) se confirmó como impuesto de ARCA sin atar, y su gasto
-- "ARCA Autónomos — período 09/2026, categoría 302 (transacción 3236)" quedó sin "✓ banco".
-- Se ata como hace ahora «Es el VEP …» en Bancos > Movimientos: la línea apunta al pago del gasto y el pago queda conciliado.
-- Sigue como impuesto de ARCA (igual que los otros 9 VEP de septiembre y octubre). No cambia montos, ni crea ni borra nada.
-- Si algo no está como se espera, no cambia nada (tira error).
-- Vuelta atrás: supabase/rollback/20261027120000_atar_vep_autonomos_2310.sql
begin;

do $$
begin
  if not exists (
    select 1 from public.extracto_movimientos em
      join public.extractos_bancarios eb on eb.id = em.extracto_id
    where em.id = '2ddeba5c-d0a1-45a3-ba00-747e3ff7cc8c' and eb.sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021'
      and em.fecha = '2026-10-23' and em.monto = 107789.20 and em.tipo::text = 'debito' and em.estado::text = 'matcheado'
      and em.clasificacion = 'impuesto' and em.match_movimiento_id is null
  ) then raise exception 'La línea del 23/10 por $ 107.789,20 no está como se esperaba (confirmada como impuesto y sin atar): no se cambia nada'; end if;

  if not exists (
    select 1 from public.movimientos
    where id = '4df2d89c-2232-4374-b67e-e1e3dd4796c9' and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021'
      and gasto_manual_id = '8ddf6090-ebb8-4662-9bb4-4b095bb38e6b' and tipo = 'pago' and monto = 107789.20
      and not coalesce(anulado, false) and not coalesce(conciliado, false)
  ) then raise exception 'El pago del gasto de Autónomos no está como se esperaba (activo, sin conciliar, $ 107.789,20): no se cambia nada'; end if;

  if exists (select 1 from public.extracto_movimientos where match_movimiento_id = '4df2d89c-2232-4374-b67e-e1e3dd4796c9') then
    raise exception 'El pago del gasto de Autónomos ya está atado a otra línea del banco: no se cambia nada';
  end if;
end $$;

-- Lo mismo que hace aplicar_cruces_extracto al atar (la cuenta del pago ya es la del banco, BBVA CC EPP).
update public.movimientos set conciliado = true, conciliado_at = now()
  where id = '4df2d89c-2232-4374-b67e-e1e3dd4796c9' and not coalesce(conciliado, false);

update public.extracto_movimientos set
    match_movimiento_id = '4df2d89c-2232-4374-b67e-e1e3dd4796c9',
    nota = 'Impuesto debitado por el banco (PAGO SERVICI 17779347 OP3636): $ 107.789,20. VEP cargado en Gastos: ARCA Autónomos — período 09/2026, categoría 302 (transacción 3236).'
  where id = '2ddeba5c-d0a1-45a3-ba00-747e3ff7cc8c' and match_movimiento_id is null;

commit;
