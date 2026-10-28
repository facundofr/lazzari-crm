-- Dashboard: tasa de conversión con los estados ganados y perdidos de siempre (auditoría integral 28/10/2026, Tanda 7, H39;
-- Augusto: "Arreglarla igual").
-- Antes get_dashboard_kpis contaba como ganado solo 'aprobado' y como perdido solo 'rechazado': como casi todos los PR
-- ganados pasan a 'facturado', la tasa daba ~7 % cuando la real es ~80 %.
-- Ahora usa la misma regla que la Ficha 360 (src/lib/oportunidades.ts):
--   ganados  = aprobado, facturar, facturado, remitido, entregado
--   perdidos = rechazado, vencido, postergado, cancelada, cancelado
--   conversión = ganados / (ganados + perdidos), últimos 3 meses.
-- Además: los PR en la Papelera (eliminado) ya no cuentan en conversión, PR activos ni pendientes, y el margen promedio
-- usa los PR ganados (antes solo los 'aprobado', que hoy son 3).
-- No toca datos: solo cambia la función (mismos parámetros y permisos). El resto de los números no cambia.
-- Prueba: scripts/db/pruebas/dashboard_conversion.sql
-- Vuelta atrás: supabase/rollback/20261028185000_dashboard_conversion_ganados.sql
begin;

CREATE OR REPLACE FUNCTION public.get_dashboard_kpis(p_sociedad_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
  v_hoy date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  v_inicio_mes date := date_trunc('month', v_hoy)::date;
  v_inicio_mes_anterior date := (date_trunc('month', v_hoy) - interval '1 month')::date;
  v_ventas jsonb;
  v_pend jsonb;
  v_cobr jsonb;
BEGIN
  -- Ventas: NC en negativo, ARS y USD por separado, sin anuladas ni NC de facturas anuladas.
  SELECT jsonb_build_object(
    'mes_ars', COALESCE(SUM(m) FILTER (WHERE fecha >= v_inicio_mes AND NOT usd), 0),
    'mes_usd', COALESCE(SUM(m) FILTER (WHERE fecha >= v_inicio_mes AND usd), 0),
    'ant_ars', COALESCE(SUM(m) FILTER (WHERE fecha < v_inicio_mes AND NOT usd), 0),
    'ant_usd', COALESCE(SUM(m) FILTER (WHERE fecha < v_inicio_mes AND usd), 0)
  ) INTO v_ventas
  FROM (
    SELECT f.fecha,
           upper(COALESCE(f.moneda::text, '')) LIKE '%USD%' AS usd,
           CASE WHEN upper(replace(COALESCE(f.tipo::text, ''), ' ', '')) LIKE 'NC%' THEN -1 ELSE 1 END * COALESCE(f.total, 0) AS m
    FROM public.facturas f
    WHERE f.fecha >= v_inicio_mes_anterior
      AND f.estado <> 'anulada'
      AND (p_sociedad_id IS NULL OR f.sociedad_id = p_sociedad_id)
      AND NOT (
        upper(replace(COALESCE(f.tipo::text, ''), ' ', '')) LIKE 'NC%'
        AND f.factura_origen_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM public.facturas o WHERE o.id = f.factura_origen_id AND o.estado = 'anulada')
      )
  ) v;

  -- Pendiente de cobro: saldo real de cada factura (como Facturación / Finanzas).
  WITH fac AS (
    SELECT f.id, COALESCE(f.total, 0) - COALESCE(f.total_acreditado, 0) AS neto,
           upper(COALESCE(f.moneda::text, '')) LIKE '%USD%' AS usd
    FROM public.facturas f
    WHERE f.estado NOT IN ('anulada', 'pagada')
      AND upper(replace(COALESCE(f.tipo::text, ''), ' ', '')) NOT LIKE 'NC%'
      AND (p_sociedad_id IS NULL OR f.sociedad_id = p_sociedad_id)
  ),
  apl AS (
    SELECT a.factura_id, a.movimiento_id, a.monto
    FROM public.cobro_aplicaciones a
    JOIN public.movimientos mv ON mv.id = a.movimiento_id
    WHERE COALESCE(mv.anulado, false) = false
      AND a.factura_id IN (SELECT id FROM fac)
  ),
  cobrado AS (
    SELECT factura_id, SUM(monto) AS monto FROM (
      SELECT factura_id, monto FROM apl
      UNION ALL
      SELECT m.factura_id, m.monto
      FROM public.movimientos m
      JOIN fac ON fac.id = m.factura_id
      WHERE COALESCE(m.anulado, false) = false
        AND (m.moneda IS NULL OR (upper(m.moneda::text) LIKE '%USD%') = fac.usd)
        AND NOT EXISTS (SELECT 1 FROM public.cobro_aplicaciones a2 WHERE a2.movimiento_id = m.id)
    ) x GROUP BY factura_id
  )
  SELECT jsonb_build_object(
    'ars', COALESCE(SUM(s) FILTER (WHERE NOT usd), 0),
    'usd', COALESCE(SUM(s) FILTER (WHERE usd), 0)
  ) INTO v_pend
  FROM (
    SELECT fac.usd, GREATEST(0, round((fac.neto - COALESCE(c.monto, 0))::numeric, 2)) AS s
    FROM fac LEFT JOIN cobrado c ON c.factura_id = fac.id
  ) p;

  -- Cobranzas del mes: sin anulados, por moneda.
  SELECT jsonb_build_object(
    'ars', COALESCE(SUM(monto) FILTER (WHERE upper(COALESCE(moneda::text, '')) NOT LIKE '%USD%'), 0),
    'usd', COALESCE(SUM(monto) FILTER (WHERE upper(COALESCE(moneda::text, '')) LIKE '%USD%'), 0)
  ) INTO v_cobr
  FROM public.movimientos
  WHERE tipo IN ('cobro', 'cheque_recibido', 'transferencia', 'efectivo')
    AND cliente_id IS NOT NULL
    AND COALESCE(anulado, false) = false
    AND fecha >= v_inicio_mes
    AND (p_sociedad_id IS NULL OR sociedad_id = p_sociedad_id);

  SELECT jsonb_build_object(
    'ventas_mes', v_ventas->'mes_ars',
    'ventas_mes_usd', v_ventas->'mes_usd',
    'ventas_mes_anterior', v_ventas->'ant_ars',
    'ventas_mes_anterior_usd', v_ventas->'ant_usd',
    'facturado_mes', v_ventas->'mes_ars',
    'facturado_mes_usd', v_ventas->'mes_usd',
    'presupuestos_activos', (
      SELECT COUNT(*) FROM public.presupuestos
      WHERE estado IN ('borrador', 'pendiente', 'postergado')
        AND NOT COALESCE(eliminado, false)
        AND (p_sociedad_id IS NULL OR sociedad_id = p_sociedad_id)
    ),
    'presupuestos_pendientes', (
      SELECT COUNT(*) FROM public.presupuestos WHERE estado = 'pendiente'
        AND NOT COALESCE(eliminado, false)
        AND (p_sociedad_id IS NULL OR sociedad_id = p_sociedad_id)
    ),
    'tasa_conversion', COALESCE((
      SELECT ROUND(
        COUNT(*) FILTER (WHERE estado::text IN ('aprobado', 'facturar', 'facturado', 'remitido', 'entregado'))::numeric /
        NULLIF(COUNT(*) FILTER (WHERE estado::text IN ('aprobado', 'facturar', 'facturado', 'remitido', 'entregado') OR estado::text IN ('rechazado', 'vencido', 'postergado', 'cancelada', 'cancelado')), 0) * 100, 1
      )
      FROM public.presupuestos
      WHERE fecha >= v_inicio_mes - interval '3 months'
        AND NOT COALESCE(eliminado, false)
        AND (p_sociedad_id IS NULL OR sociedad_id = p_sociedad_id)
    ), 0),
    'cobranzas_mes', v_cobr->'ars',
    'cobranzas_mes_usd', v_cobr->'usd',
    'cobranzas_pendientes', v_pend->'ars',
    'cobranzas_pendientes_usd', v_pend->'usd',
    'clientes_activos', (
      SELECT COUNT(*) FROM public.clientes WHERE activo = true
        AND (p_sociedad_id IS NULL OR sociedad_id = p_sociedad_id)
    ),
    'stock_bajo', (
      SELECT COUNT(*) FROM public.productos
      WHERE activo = true AND stock <= stock_minimo
        AND (p_sociedad_id IS NULL OR sociedad_id = p_sociedad_id)
    ),
    'margen_promedio', COALESCE((
      SELECT ROUND(AVG(markup_general), 1) FROM public.presupuestos
      WHERE estado::text IN ('aprobado', 'facturar', 'facturado', 'remitido', 'entregado') AND fecha >= v_inicio_mes - interval '3 months'
        AND NOT COALESCE(eliminado, false)
        AND (p_sociedad_id IS NULL OR sociedad_id = p_sociedad_id)
    ), 0),
    'alertas_sin_leer', (
      SELECT COUNT(*) FROM public.alertas WHERE read = false
        AND (p_sociedad_id IS NULL OR sociedad_id = p_sociedad_id)
    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

commit;
