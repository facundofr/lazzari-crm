-- Prueba de 20261027120000_atar_vep_autonomos_2310.sql (se corre con --probar: muestra resultados y DESHACE todo).
select 'línea del 23/10 atada al pago del gasto' as control, coalesce(em.match_movimiento_id::text, 'sin atar') as valor, 'esperado 4df2d89c-2232-4374-b67e-e1e3dd4796c9' as nota
  from public.extracto_movimientos em where em.id = '2ddeba5c-d0a1-45a3-ba00-747e3ff7cc8c'
union all select 'sigue como impuesto de ARCA', em.clasificacion || ' / ' || coalesce(em.subtipo, '—') || ' / ' || em.estado::text, 'esperado impuesto / afip / matcheado'
  from public.extracto_movimientos em where em.id = '2ddeba5c-d0a1-45a3-ba00-747e3ff7cc8c'
union all select 'nota de la línea', em.nota, 'con «VEP cargado en Gastos: ARCA Autónomos …»'
  from public.extracto_movimientos em where em.id = '2ddeba5c-d0a1-45a3-ba00-747e3ff7cc8c'
union all select 'pago del gasto conciliado (✓ banco)', m.conciliado::text || ' / ' || to_char(m.monto, 'FM999G999G990D00') || ' / anulado ' || coalesce(m.anulado, false)::text, 'esperado true / 107.789,20 / anulado false'
  from public.movimientos m where m.id = '4df2d89c-2232-4374-b67e-e1e3dd4796c9'
union all select 'cuenta del pago = la de la línea', (m.cuenta_id = em.cuenta_id)::text, 'esperado true'
  from public.movimientos m, public.extracto_movimientos em where m.id = '4df2d89c-2232-4374-b67e-e1e3dd4796c9' and em.id = '2ddeba5c-d0a1-45a3-ba00-747e3ff7cc8c'
union all select 'líneas atadas a ese pago', count(*)::text, 'esperado 1'
  from public.extracto_movimientos where match_movimiento_id = '4df2d89c-2232-4374-b67e-e1e3dd4796c9'
union all select 'VEP de Impuestos sin banco (sep-oct)', count(*)::text, 'esperado 0 (antes 1)'
  from public.gastos_manuales g
  where g.sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and g.fecha >= '2026-09-01' and g.grupo = 'Impuestos' and g.descripcion ilike 'ARCA%'
    and not exists (select 1 from public.movimientos m join public.extracto_movimientos x on x.match_movimiento_id = m.id
                    where m.gasto_manual_id = g.id and not coalesce(m.anulado, false));
