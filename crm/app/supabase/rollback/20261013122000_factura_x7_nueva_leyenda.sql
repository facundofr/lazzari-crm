-- Vuelta atrás de 20261013122000_factura_x7_nueva_leyenda.sql: vuelve a $207.966,96.
begin;

update public.factura_items set precio_unitario = 34661.16
where factura_id = 'e35eaedb-a24b-4cda-b9d5-fa4b58483b87' and precio_unitario = 41940;

update public.facturas set subtotal = 207966.96, total = 207966.96
where id = 'e35eaedb-a24b-4cda-b9d5-fa4b58483b87' and total = 251640;

commit;
