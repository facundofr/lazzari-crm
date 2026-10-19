-- Vuelta atrás de 20261019180000_oc_items_moneda.sql (los renglones vuelven a usar la moneda de la OC).
begin;
alter table public.orden_compra_items drop column if exists moneda;
commit;
