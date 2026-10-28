select tipo, ajuste_sentido, monto, moneda, fecha, left(descripcion,60) d, factura_compra_id is not null con_factura, gasto_manual_id is not null con_gasto
from public.movimientos where created_at > now() - interval '5 minutes' order by tipo;
select numero_factura, estado from public.facturas_compra where id in ('17af302e-e8cc-419c-9b5e-e929ae7ea855','e63474af-c910-4b2e-a7c0-a8024edf0e53');
