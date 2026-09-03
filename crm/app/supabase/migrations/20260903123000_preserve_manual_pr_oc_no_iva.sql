-- Las ordenes de compra originadas en un PR manual mantienen importes finales
-- sin volver a discriminar ni sumar IVA.
begin;

with manual_ocs as (
  select oc.id
  from ordenes_compra oc
  join presupuestos pr on pr.id = oc.presupuesto_origen_id
  where pr.modalidad_emision = 'manual'
)
update orden_compra_items item
set iva_porcentaje = 0
where item.orden_id in (select id from manual_ocs)
  and item.iva_porcentaje <> 0;

with manual_totals as (
  select
    oc.id,
    coalesce(sum(item.cantidad * item.precio_unitario), oc.subtotal, 0) as neto
  from ordenes_compra oc
  join presupuestos pr on pr.id = oc.presupuesto_origen_id
  left join orden_compra_items item on item.orden_id = oc.id
  where pr.modalidad_emision = 'manual'
  group by oc.id, oc.subtotal
)
update ordenes_compra oc
set
  subtotal = totals.neto,
  iva = 0,
  total = totals.neto
from manual_totals totals
where oc.id = totals.id
  and (
    oc.subtotal is distinct from totals.neto
    or oc.iva is distinct from 0
    or oc.total is distinct from totals.neto
  );

commit;
