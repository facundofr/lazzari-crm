-- Catálogo de transportistas: columna "destinos" (texto libre, separado por comas) para buscar quién va a cada lugar.
-- Aditivo: arranca vacía. Vuelta atrás: supabase/rollback/20261029160000_transportistas_destinos.sql
alter table public.transportistas add column if not exists destinos text;
