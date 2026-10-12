-- Vuelta atrás de 20261012160000_oc_estados.sql
-- Saca los disparadores nuevos, deja auto_estado_oc EXACTAMENTE como estaba en la base el 12/10/2026 y devuelve los datos
-- respaldados (factura/pago de las OC, cantidades recibidas de OC-1130/1134/1173 e importes de OC-1104/1199).
-- Las funciones de ayuda y las tablas de respaldo quedan (no molestan; se pueden borrar a mano más adelante).
begin;

drop trigger if exists lz_fact_pago_oc on public.facturas_compra;
drop trigger if exists lz_fact_pago_oc on public.factura_compra_ocs;

CREATE OR REPLACE FUNCTION public.auto_estado_oc()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_total_items integer;
  v_items_completos integer;
  v_items_parciales integer;
BEGIN
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE cantidad_recibida >= cantidad),
    COUNT(*) FILTER (WHERE cantidad_recibida > 0 AND cantidad_recibida < cantidad)
  INTO v_total_items, v_items_completos, v_items_parciales
  FROM public.orden_compra_items
  WHERE orden_id = NEW.orden_id;

  IF v_items_completos = v_total_items THEN
    UPDATE public.ordenes_compra SET estado = 'recibida' WHERE id = NEW.orden_id;
  ELSIF v_items_completos > 0 OR v_items_parciales > 0 THEN
    UPDATE public.ordenes_compra SET estado = 'recibida_parcial' WHERE id = NEW.orden_id;
  END IF;

  RETURN NEW;
END;
$function$;

update public.ordenes_compra oc
set estado_facturacion = b.estado_facturacion, estado_pago = b.estado_pago, medio_pago = b.medio_pago, pagada_at = b.pagada_at
from public.lz_backup_oc_estados_20261012 b
where oc.id = b.id;

update public.orden_compra_items i
set cantidad_recibida = b.cantidad_recibida
from public.lz_backup_oc_items_recibido_20261012 b
where i.id = b.id;

-- Las 3 OC vuelven a "recibida" (la vuelta de las cantidades a 0 no cambia el estado: auto_estado_oc no baja estados).
update public.ordenes_compra oc
set estado = 'recibida'
where oc.id in (select distinct orden_id from public.lz_backup_oc_items_recibido_20261012);

update public.ordenes_compra oc
set subtotal = b.subtotal, iva = b.iva, total = b.total
from public.lz_backup_oc_iva_20261012 b
where oc.id = b.id
  and b.numero in ('OC-2026-1104', 'OC-2026-1199');

commit;
