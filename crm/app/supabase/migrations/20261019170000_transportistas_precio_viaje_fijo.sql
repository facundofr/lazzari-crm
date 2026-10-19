-- Precio fijo por viaje del transportista (ej. José Álvarez). Si el viaje no tiene precio, vale este.
-- Aditiva: una columna nueva, sin tocar datos. Pedido de Augusto 19/10/2026.
-- Vuelta atrás: supabase/rollback/20261019170000_transportistas_precio_viaje_fijo.sql
begin;
alter table public.transportistas add column if not exists precio_viaje_fijo numeric(14,2);
comment on column public.transportistas.precio_viaje_fijo is 'Precio fijo por viaje (Transportes). Vacío = cada viaje lleva su precio.';
commit;
