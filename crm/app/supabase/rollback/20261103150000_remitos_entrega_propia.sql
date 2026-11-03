-- Vuelta atrás de 20261103150000_remitos_entrega_propia.sql
-- ⚠️ Antes de correrla, volver el código a la versión anterior (la nueva lee y guarda remitos.entrega_propia).
-- Devuelve el transportista de los remitos que lo tomaron de su viaje, saca la columna y el respaldo. No toca Transportes.
begin;
update public.remitos r set transportista_id = a.transportista_id_antes
from public.lz_remitos_entrega_antes a where a.remito_id = r.id;
alter table public.remitos drop column if exists entrega_propia;
drop table if exists public.lz_remitos_entrega_antes;
commit;
