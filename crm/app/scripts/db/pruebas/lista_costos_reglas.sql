-- Prueba (siempre se deshace): el descuento anticipado queda sincronizado en las dos direcciones.
insert into public.proveedor_descuentos_opcionales (proveedor_lista, tipo, porcentaje) values ('SPI', 'pago_anticipado', 5);
select 'despues de cargar SPI 5%' as paso, p.razon_social, s.nombre, p.descuento_pronto_pago from proveedores p join sociedades s on s.id = p.sociedad_id
 where p.id in (select proveedor_id from catalogo_proveedores where proveedor_lista = 'SPI');
update public.proveedores set descuento_pronto_pago = 4 where id = (select proveedor_id from catalogo_proveedores where proveedor_lista = 'SPI' limit 1);
select 'despues de editar la ficha a 4%' as paso, (select porcentaje from proveedor_descuentos_opcionales where proveedor_lista='SPI' and tipo='pago_anticipado') as en_regla,
 (select string_agg(descuento_pronto_pago::text, ', ') from proveedores where id in (select proveedor_id from catalogo_proveedores where proveedor_lista='SPI')) as en_fichas;
