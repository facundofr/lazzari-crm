-- Prueba de 20261028161000: cambiar el total de la FC 0007-00024709 (ya pagada con 1.023.677,92) deja un aviso y NO frena. Se deshace todo.
update public.facturas_compra set total = 700000 where numero_factura = '0007-00024709';
select titulo, motivo, importe, moneda, estado from public.finanzas_revisar where motivo='total_cambiado_pagada';
update public.facturas_compra set total = 700000 where numero_factura = '0007-00024709';
select count(*) as avisos_tras_update_sin_cambio from public.finanzas_revisar where motivo='total_cambiado_pagada';
update public.facturas_compra set total = 1023677.92 where numero_factura = '0007-00024709';
select count(*) as avisos_al_dejarla_justa from public.finanzas_revisar where motivo='total_cambiado_pagada';
select total from public.facturas_compra where numero_factura = '0007-00024709';
