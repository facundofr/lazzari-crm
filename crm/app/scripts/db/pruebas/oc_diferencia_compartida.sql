-- Prueba de 20261012190000_oc_diferencia_compartida.sql (se corre con --probar: al final se deshace todo).
select set_config('request.jwt.claims', '{"sub":"cb8fdf3e-d171-4042-9da7-248fe863b96d","role":"authenticated"}', true);

-- Todas las OC que tienen alguna factura repartida con otra OC: total de la OC contra lo facturado que le toca.
select o.numero, o.total as oc_total,
       (d->>'fc_total')::numeric as fc_total,
       round(o.total - (d->>'fc_total')::numeric, 2) as diferencia,
       d->>'cant_pedida' as pedida, d->>'cant_facturada' as facturada, d->>'n_facturas' as n_fc
from ordenes_compra o
cross join lateral (select public.diagnostico_diferencia_oc(o.sociedad_id, o.id) as d) x
where exists (
  select 1 from factura_compra_ocs l join factura_compra_ocs l2 on l2.factura_compra_id = l.factura_compra_id and l2.orden_compra_id <> l.orden_compra_id
  where l.orden_compra_id = o.id)
order by 1;
