-- Vuelta atrás de 20261030160000_mercado_libre_facturas.sql: saca las 2 funciones de la pestaña Mercado Libre.
-- Las uniones ya hechas (factura_compra_asignaciones con origen 'mercado_libre') quedan como están: son solo vínculos y la
-- OC sigue mostrándose facturada. Si también se quieren sacar, correr aparte (borra solo esas uniones, no facturas):
--   delete from public.factura_compra_asignaciones where origen = 'mercado_libre';
begin;
drop function if exists public.unir_factura_mercado_libre(uuid, uuid[]);
drop function if exists public.quitar_factura_mercado_libre(uuid, uuid);
commit;
