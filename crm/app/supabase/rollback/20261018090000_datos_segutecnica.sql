-- Vuelta atrás de 20261018090000_datos_segutecnica.sql (deja todo como estaba antes).
update public.facturas_compra set fecha_vencimiento = null
 where numero_factura = '00014-00073760' and proveedor_id = '510b01a8-fee6-4d81-b648-d292fbef4b4a' and fecha_vencimiento = '2026-12-15';
update public.proveedores set cbu = '', banco = null where id = '510b01a8-fee6-4d81-b648-d292fbef4b4a' and cbu = '0170486420000000018344';
update public.proveedores set cbu = null, banco = null where id = '053e8738-edc2-4db2-9a81-0be41d026d04' and cbu = '0170486420000000018344';
