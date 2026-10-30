-- Factura 0002-00064652 de Pluscargo Rosario (14/10/2026) quedó con tipo "mercaderia" (de antes del arreglo del tipo en Transportes).
-- Gastos, Reportes y Contabilidad cuentan Transportes solo con tipo "transporte". Un solo registro. Aditivo.
-- Vuelta atrás: supabase/rollback/20261030150000_factura_pluscargo_tipo_transporte.sql
begin;
update public.facturas_compra set tipo = 'transporte'
where id = '96b15af4-0fc3-40a3-a2eb-6a47ba5be933' and numero_factura = '0002-00064652' and tipo = 'mercaderia';
commit;
