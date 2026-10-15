-- Vuelta atrás: borra solo los 2 gastos fijos y los 2 proveedores que creó 20261015120000 (en Lazzari).
-- Los proveedores de Grupo LA no se tocan. Si un proveedor ya tiene facturas o pagos cargados, la base no deja borrarlo (queda inactivo).
begin;
delete from public.gastos_fijos
 where sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021'
   and descripcion in ('Natalia Inga (consultora)', 'Leandro Porcel (coaching empresarial)');
update public.proveedores set activo = false
 where sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and cuit in ('27237546321', '20253118807');
commit;
