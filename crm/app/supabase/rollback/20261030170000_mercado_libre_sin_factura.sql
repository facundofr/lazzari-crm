-- Vuelta atrás de 20261030170000_mercado_libre_sin_factura.sql: saca «No tiene factura» de la pestaña Mercado Libre.
-- Se pierden las marcas y sus motivos (esos artículos vuelven a decir «Falta la factura»). No toca OC, facturas ni pagos.
begin;
drop function if exists public.marcar_mercado_libre_sin_factura(uuid, text);
drop function if exists public.desmarcar_mercado_libre_sin_factura(uuid);
drop table if exists public.mercado_libre_sin_factura;
commit;
