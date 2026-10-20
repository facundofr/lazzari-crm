-- Vuelta atrás de 20261018130000_proveedor_mateo_perrone.sql (solo si todavía no tiene facturas ni pagos).
begin;
delete from public.proveedores where id = '5a7e0c11-8d2b-4e61-9c3f-18102026a7e0';
update public.transportistas set razon_social = null, cuit = null, email = null, observaciones = null
where id = 'd9ef3b98-1f9f-45e1-9017-072a55166c85';
commit;
