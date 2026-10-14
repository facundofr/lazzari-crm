-- Facturas de servicio / gasto (contador, alquiler, luz…): categoría del gasto en la factura de compra. Solo agrega una columna vacía.
begin;
alter table public.facturas_compra add column if not exists categoria_gasto text;
commit;
