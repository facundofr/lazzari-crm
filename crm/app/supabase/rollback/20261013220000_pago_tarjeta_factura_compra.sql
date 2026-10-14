-- Vuelta atrás de 20261013220000_pago_tarjeta_factura_compra.sql: saca las dos funciones (los pagos ya registrados quedan).
begin;
drop function if exists public.registrar_pago_tarjeta_factura_compra(uuid, uuid);
drop function if exists public.tarjetas_de_sociedad(uuid);
commit;
