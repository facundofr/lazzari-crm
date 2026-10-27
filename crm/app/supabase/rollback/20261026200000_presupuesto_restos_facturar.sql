-- Vuelta atrás de 20261026200000_presupuesto_restos_facturar.sql: saca la tabla de restos a facturar
-- (se pierde la lista de lo que quedó sin facturar; las facturas y los PR quedan como están).
begin;
drop table if exists public.presupuesto_restos_facturar;
commit;
