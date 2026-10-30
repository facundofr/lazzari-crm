-- Vuelta atrás de 20261030150000_factura_pluscargo_tipo_transporte.sql
begin;
update public.facturas_compra set tipo = 'mercaderia'
where id = '96b15af4-0fc3-40a3-a2eb-6a47ba5be933' and numero_factura = '0002-00064652' and tipo = 'transporte';
commit;
