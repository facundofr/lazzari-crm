-- Vuelta atrás de 20261012240000_dashboard_kpis_monedas.sql
-- Deja get_dashboard_kpis(uuid) exactamente como estaba antes (copiada de la base el 12/10/2026).
begin;

CREATE OR REPLACE FUNCTION public.get_dashboard_kpis(p_sociedad_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_result jsonb;
  v_inicio_mes date := date_trunc('month', CURRENT_DATE);
  v_inicio_mes_anterior date := date_trunc('month', CURRENT_DATE - interval '1 month');
BEGIN
  SELECT jsonb_build_object(
    'ventas_mes', COALESCE((
      SELECT SUM(total) FROM public.facturas 
      WHERE fecha >= v_inicio_mes AND estado != 'anulada'
        AND (p_sociedad_id IS NULL OR sociedad_id = p_sociedad_id)
    ), 0),
    'ventas_mes_anterior', COALESCE((
      SELECT SUM(total) FROM public.facturas 
      WHERE fecha >= v_inicio_mes_anterior AND fecha < v_inicio_mes AND estado != 'anulada'
        AND (p_sociedad_id IS NULL OR sociedad_id = p_sociedad_id)
    ), 0),
    'presupuestos_activos', (
      SELECT COUNT(*) FROM public.presupuestos 
      WHERE estado IN ('borrador', 'pendiente', 'postergado')
        AND (p_sociedad_id IS NULL OR sociedad_id = p_sociedad_id)
    ),
    'presupuestos_pendientes', (
      SELECT COUNT(*) FROM public.presupuestos WHERE estado = 'pendiente'
        AND (p_sociedad_id IS NULL OR sociedad_id = p_sociedad_id)
    ),
    'tasa_conversion', COALESCE((
      SELECT ROUND(
        COUNT(*) FILTER (WHERE estado = 'aprobado')::numeric / 
        NULLIF(COUNT(*) FILTER (WHERE estado IN ('aprobado', 'rechazado')), 0) * 100, 1
      )
      FROM public.presupuestos 
      WHERE fecha >= v_inicio_mes - interval '3 months'
        AND (p_sociedad_id IS NULL OR sociedad_id = p_sociedad_id)
    ), 0),
    'cobranzas_mes', COALESCE((
      SELECT SUM(monto) FROM public.movimientos 
      WHERE tipo IN ('cobro', 'cheque_recibido', 'transferencia', 'efectivo')
        AND cliente_id IS NOT NULL
        AND fecha >= v_inicio_mes
        AND (p_sociedad_id IS NULL OR sociedad_id = p_sociedad_id)
    ), 0),
    'cobranzas_pendientes', COALESCE((
      SELECT SUM(total) FROM public.facturas 
      WHERE estado = 'emitida'
        AND (p_sociedad_id IS NULL OR sociedad_id = p_sociedad_id)
    ), 0),
    'clientes_activos', (
      SELECT COUNT(*) FROM public.clientes WHERE activo = true
        AND (p_sociedad_id IS NULL OR sociedad_id = p_sociedad_id)
    ),
    'stock_bajo', (
      SELECT COUNT(*) FROM public.productos 
      WHERE activo = true AND stock <= stock_minimo
        AND (p_sociedad_id IS NULL OR sociedad_id = p_sociedad_id)
    ),
    'facturado_mes', COALESCE((
      SELECT SUM(total) FROM public.facturas 
      WHERE fecha >= v_inicio_mes AND estado != 'anulada'
        AND (p_sociedad_id IS NULL OR sociedad_id = p_sociedad_id)
    ), 0),
    'margen_promedio', COALESCE((
      SELECT ROUND(AVG(markup_general), 1) FROM public.presupuestos 
      WHERE estado = 'aprobado' AND fecha >= v_inicio_mes - interval '3 months'
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
