-- Vuelta atrás de 20261016150000_oc_remitos.sql (pierde el historial de remitos de proveedor y sus fotos vinculadas; las cantidades recibidas en las OC quedan como están).
begin;
drop table if exists public.oc_remitos;
commit;
