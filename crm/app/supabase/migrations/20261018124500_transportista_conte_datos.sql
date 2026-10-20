-- Transportista CONTE: CUIT y mail (de la factura de Conte Hnos y Cía SA). Solo completa vacíos. 18/10/2026.
-- Vuelta atrás: supabase/rollback/20261018124500_transportista_conte_datos.sql
begin;
update public.transportistas set razon_social = 'CONTE HNOS Y CIA S A', cuit = '33539819149', email = 'Contepergamino@gmail.com'
where id = '9bebf9f7-47d2-4cbb-b950-8400da38390c';
commit;
