-- Prueba de 20261012230000_proveedores_formas_pago.sql (se corre con --probar: al final se deshace todo).
select set_config('request.jwt.claims', '{"sub":"cb8fdf3e-d171-4042-9da7-248fe863b96d","role":"authenticated"}', true);
select s.nombre, p.razon_social, p.condicion_pago, p.dias_pago, p.dias_pago_hasta, p.medios_pago, p.medio_pago_preferido, p.descuento_pronto_pago
from proveedores p join sociedades s on s.id = p.sociedad_id
where p.condicion_pago is not null or p.descuento_pronto_pago is not null order by 2, 1;
select medio_pago_preferido, count(*) from proveedores group by 1 order by 2 desc;
select s.nombre, f.mes, f.dias from cheque_fechas_mes f join sociedades s on s.id = f.sociedad_id order by 1, 2;
