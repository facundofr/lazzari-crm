-- Vuelta atrás de 20261013230000_factura_servicio_categoria.sql: saca la columna (se pierde solo la categoría cargada).
begin;
alter table public.facturas_compra drop column if exists categoria_gasto;
commit;
