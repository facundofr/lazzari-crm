-- Prueba de 20261029190000_fletes_a_transporte: las 4 quedan transporte, sin cambiar estado, total ni pagos; Transportes por mes.
select p.razon_social, f.numero_factura, f.tipo, f.estado::text, f.total,
  (select count(*) from op_facturas_compra x where x.factura_compra_id = f.id) ops
from facturas_compra f join proveedores p on p.id = f.proveedor_id
where f.id in ('8a6250af-cc80-41c8-bed6-af2bd81149b8','263968c1-e7ec-48a1-9a43-89497582ab40','2b1e388a-f960-4d83-b44d-684a9c5b4827','dc88f81b-4af3-4bb6-a8e5-4d6b94d543b1');
select to_char(fecha, 'YYYY-MM') mes, count(*) facturas, sum(subtotal) neto
from facturas_compra where sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and tipo = 'transporte' and estado <> 'anulada' and fecha >= '2026-09-01'
group by 1 order by 1;
