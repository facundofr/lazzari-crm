-- Vuelta atrás de 20261018124500_transportista_conte_datos.sql (valores del 18/10/2026).
begin;
update public.transportistas set razon_social = null, cuit = null, email = null where id = '9bebf9f7-47d2-4cbb-b950-8400da38390c';
commit;
