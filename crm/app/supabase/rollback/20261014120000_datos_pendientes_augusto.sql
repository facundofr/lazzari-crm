-- Vuelta atrás de 20261014120000_datos_pendientes_augusto.sql: saca solo los 9 pendientes que agregó (por id).
begin;
delete from public.pendientes where id::text like '7b2e0d20-0001-4e00-9a00-00000000000_';
commit;
