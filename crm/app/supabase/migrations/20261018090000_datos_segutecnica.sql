-- Datos (17-18/10/2026, OK de Augusto): no cambia tablas.
-- 1) FC Segutécnica 0014-73760 (Lazzari): se cargó con la versión vieja y quedó sin vencimiento. eCheq a 60 días → 16/10 + 60 = 15/12/2026.
update public.facturas_compra set fecha_vencimiento = '2026-12-15'
 where numero_factura = '00014-00073760' and proveedor_id = '510b01a8-fee6-4d81-b648-d292fbef4b4a' and fecha_vencimiento is null;
-- 2) CBU de Segutécnica (sale en sus facturas: Banco Francés), en los dos proveedores (Lazzari y Grupo LA), solo si estaba vacío.
update public.proveedores set cbu = '0170486420000000018344', banco = coalesce(nullif(banco,''), 'Banco Francés')
 where id in ('510b01a8-fee6-4d81-b648-d292fbef4b4a','053e8738-edc2-4db2-9a81-0be41d026d04') and coalesce(cbu,'') = '';
