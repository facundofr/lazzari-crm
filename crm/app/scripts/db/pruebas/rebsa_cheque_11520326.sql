-- Prueba de 20261027130000_rebsa_cheque_11520326.sql (se corre con --probar: muestra resultados y DESHACE todo).
select 'cheques de Rebsa del recibo 1078' as control,
       string_agg(e.numero || ' · pago ' || to_char(e.fecha_pago, 'DD/MM/YYYY') || ' · $ ' || to_char(e.monto, 'FM999G999G990D00') || ' · ' || e.estado, ' | ' order by e.numero) as valor,
       'esperado 11520326 · pago 23/11/2026 … | 11520327 · pago 07/11/2026 …' as nota
  from public.echeqs e
  where e.movimiento_id in ('c1da91de-208a-43b1-84a3-ab48342bf1ba', '51068f39-8a57-44c8-bbcb-e46579c8db52')
union all select 'el 11520326 es el del cobro con «Ref: 11520326»', (m.descripcion like '%Ref: 11520326%')::text, 'esperado true'
  from public.echeqs e join public.movimientos m on m.id = e.movimiento_id where e.numero = '11520326'
union all select 'cheques con el N° 11520327', count(*)::text, 'esperado 1 (antes 2)'
  from public.echeqs where sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and numero = '11520327'
union all select 'cobros y recibo sin cambios', count(*)::text || ' cobros activos de $ ' || to_char(sum(m.monto), 'FM999G999G990D00'), 'esperado 2 cobros activos de $ 538.208,00'
  from public.movimientos m where m.id in ('c1da91de-208a-43b1-84a3-ab48342bf1ba', '51068f39-8a57-44c8-bbcb-e46579c8db52') and not coalesce(m.anulado, false);
