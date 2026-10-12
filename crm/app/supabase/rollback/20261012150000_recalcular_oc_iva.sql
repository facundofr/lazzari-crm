-- Vuelta atrás de 20261012150000_recalcular_oc_iva.sql
-- Deja recalcular_oc EXACTAMENTE como estaba en la base el 12/10/2026 (IVA 21 % fijo) y devuelve a las 10 OC corregidas
-- los importes que tenían antes (guardados en lz_backup_oc_iva_20261012).
-- La función de ayuda y la tabla de respaldo quedan (no molestan; se pueden borrar a mano más adelante).
begin;

CREATE OR REPLACE FUNCTION public.recalcular_oc()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_orden_id uuid;
BEGIN
  v_orden_id := COALESCE(NEW.orden_id, OLD.orden_id);

  UPDATE public.ordenes_compra
  SET
    subtotal = COALESCE(sub.sum_subtotal, 0),
    iva = COALESCE(sub.sum_subtotal * 0.21, 0),
    total = COALESCE(sub.sum_subtotal * 1.21, 0)
  FROM (
    SELECT SUM(cantidad * precio_unitario) as sum_subtotal
    FROM public.orden_compra_items
    WHERE orden_id = v_orden_id
  ) sub
  WHERE id = v_orden_id;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- OC-2026-1173: renglones otra vez al 10,5 %.
update public.orden_compra_items i
set iva_porcentaje = 10.5
from public.ordenes_compra oc
where i.orden_id = oc.id
  and oc.numero = 'OC-2026-1173'
  and oc.sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021'
  and i.iva_porcentaje = 21;

update public.ordenes_compra oc
set subtotal = b.subtotal, iva = b.iva, total = b.total
from public.lz_backup_oc_iva_20261012 b
where oc.id = b.id;

commit;
