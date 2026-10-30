-- Vuelta atrás de 20261029140000_proveedor_jose_rodriguez.sql (solo si todavía no tiene facturas ni pagos).
begin;
delete from public.proveedores where id = '7c2e51a4-3b9d-4f60-a1d8-29102026b0c4';
update public.transportistas set cuit = null where id = '41139623-d2ff-4253-a9e2-012b1fb357f1' and cuit = '20313644074';
commit;
