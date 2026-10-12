-- Prueba de 20261012180000_oc_diferencias.sql (se corre con --probar: al final se deshace todo).
select set_config('request.jwt.claims', '{"sub":"cb8fdf3e-d171-4042-9da7-248fe863b96d","role":"authenticated"}', true);

create temp table antes as
select o.numero, o.total, o.estado_pago, o.estado_facturacion from ordenes_compra o
where o.numero in ('OC-2026-1062','OC-2026-1088','OC-2026-1180','OC-2026-1199');

create temp table pr_antes as
select pi.id, pi.precio_costo, pi.markup_porcentaje, pi.precio_venta from presupuesto_items pi
join ordenes_compra o on o.presupuesto_origen_id = pi.presupuesto_id
where o.numero in ('OC-2026-1062','OC-2026-1088','OC-2026-1180');

select o.numero, public.diagnostico_diferencia_oc(o.sociedad_id, o.id) as diag from ordenes_compra o
where o.numero in ('OC-2026-1062','OC-2026-1088','OC-2026-1180','OC-2026-1199') order by 1;

select o.numero, public.ajustar_oc_a_factura(o.sociedad_id, o.id) as resultado from ordenes_compra o
where o.numero in ('OC-2026-1062','OC-2026-1088','OC-2026-1180') order by 1;

select public.cerrar_saldo_oc(o.sociedad_id, o.id, true, 'Prueba: no entrega el resto') from ordenes_compra o where o.numero = 'OC-2026-1199';

select a.numero, a.total as total_antes, o.total as total_ahora, a.estado_pago as pago_antes, o.estado_pago as pago_ahora,
       a.estado_facturacion as fact_antes, o.estado_facturacion as fact_ahora
from antes a join ordenes_compra o on o.numero = a.numero order by 1;

select pi.descripcion, a.precio_costo as costo_antes, pi.precio_costo as costo_ahora, a.markup_porcentaje as margen_antes,
       pi.markup_porcentaje as margen_ahora, a.precio_venta as venta_antes, pi.precio_venta as venta_ahora
from pr_antes a join presupuesto_items pi on pi.id = a.id where a.precio_costo <> pi.precio_costo;

select title, description from alertas where title like 'OC-2026-1199%' order by created_at desc limit 1;

select public.deshacer_ajuste_oc(o.sociedad_id, o.id) as deshechos, o.numero from ordenes_compra o where o.numero = 'OC-2026-1062';
select o.numero, o.total, o.estado_pago, o.estado_facturacion from ordenes_compra o where o.numero = 'OC-2026-1062';
