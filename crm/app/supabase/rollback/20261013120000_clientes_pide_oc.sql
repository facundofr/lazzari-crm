-- Vuelta atrás de 20261013120000_clientes_pide_oc.sql: quita la marca "Pide OC para facturar".
begin;

alter table public.clientes drop column if exists pide_oc_para_facturar;

commit;
