-- Vuelta atrás de 20261019160000_rapido_plus_ultra.sql (valores del 19/10/2026).
begin;
update public.proveedores set es_transportista = true, activo = true, notas = '' where id = 'db1a182b-6bff-423f-8956-c4259ad9c1d4';
update public.transportistas set activo = false where cuit = '30717750701';
commit;
