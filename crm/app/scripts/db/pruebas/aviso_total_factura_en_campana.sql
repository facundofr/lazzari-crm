-- Cambia el total de la FC 0007-00024709 (ya pagada con 1.023.677,92) y mira que deje el aviso en la campana (alertas) y no frene. Se deshace todo.
update public.facturas_compra set total = 700000 where numero_factura = '0007-00024709';
select tipo, title, left(description, 70) d, entity_type, module, read from public.alertas where entity_type = 'factura_compra' and title like 'FC 0007-00024709%';
select total from public.facturas_compra where numero_factura = '0007-00024709';
