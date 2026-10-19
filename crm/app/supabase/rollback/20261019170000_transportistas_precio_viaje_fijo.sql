-- Vuelta atrás de 20261019170000_transportistas_precio_viaje_fijo.sql (pierde los precios fijos cargados).
begin;
alter table public.transportistas drop column if exists precio_viaje_fijo;
commit;
