-- Vuelta atrás de 20261029120000: saca la función, el índice y la columna emision_request_key (la ruta vuelve a avisar
-- "requiere conciliación" si se usa sin la función). No toca facturas ya registradas.
begin;
drop function if exists public.registrar_factura_venta_autorizada(uuid, uuid, jsonb, jsonb);
drop index if exists public.facturas_emision_request_key_uidx;
alter table public.facturas drop column if exists emision_request_key;
commit;
