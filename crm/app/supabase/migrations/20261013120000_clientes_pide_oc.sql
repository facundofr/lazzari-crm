-- Marca en la ficha del cliente: "Pide OC para facturar" — 13/10/2026, con OK de Augusto.
-- Ventas muestra esas ventas en "Esperando OC" hasta que el presupuesto tenga la OC del cliente.
-- Es solo un aviso: se puede facturar igual. Cambio aditivo (una columna nueva, por defecto false).
-- Vuelta atrás: supabase/rollback/20261013120000_clientes_pide_oc.sql
begin;

alter table public.clientes add column if not exists pide_oc_para_facturar boolean not null default false;
comment on column public.clientes.pide_oc_para_facturar is 'El cliente manda OC antes de facturar: Ventas avisa "Esperando OC" (no bloquea).';

commit;
