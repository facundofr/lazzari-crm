-- Vuelta atrás de 20261016200000_compras_lazza_observar.sql: saca las columnas nuevas (se pierden las marcas "Observar" y sus notas; nada más).
begin;
alter table public.facturas_compra drop column if exists observar_nota;
alter table public.facturas_compra drop column if exists observar;
alter table public.ordenes_compra drop column if exists observar_nota;
alter table public.ordenes_compra drop column if exists observar;
commit;
