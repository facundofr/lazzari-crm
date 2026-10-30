-- Transportes: tilde "No nos factura" en el catálogo de transportistas. Los que lo tienen se liquidan con una
-- factura manual desde Transportes; los demás facturan y se cargan en Compras Lazza. Aditivo: arranca en false para todos.
-- Vuelta atrás: supabase/rollback/20261029130000_transportistas_no_factura.sql
alter table public.transportistas add column if not exists no_factura boolean not null default false;
