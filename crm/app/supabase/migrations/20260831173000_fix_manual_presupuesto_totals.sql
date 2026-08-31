-- En los presupuestos manuales el precio de venta ingresado es final.
-- Normaliza los existentes y evita que la interfaz siga mostrando IVA agregado.

update public.presupuesto_items pi
set iva_porcentaje = 0
from public.presupuestos p
where p.id = pi.presupuesto_id
  and p.modalidad_emision = 'manual'
  and coalesce(pi.iva_porcentaje, 0) <> 0;

update public.presupuestos p
set subtotal = totals.subtotal,
    iva = 0,
    total = totals.subtotal
from (
  select pi.presupuesto_id, round(sum(pi.subtotal), 2) as subtotal
  from public.presupuesto_items pi
  join public.presupuestos pr on pr.id = pi.presupuesto_id
  where pr.modalidad_emision = 'manual'
  group by pi.presupuesto_id
) totals
where p.id = totals.presupuesto_id
  and p.modalidad_emision = 'manual';
