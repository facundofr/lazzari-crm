-- "Credifin" es SPEED BUSINESS S. A. (CUIT 30686978350). Solo datos, en Lazzari. Pedido de Augusto 18/10/2026.
-- Vuelta atrás: supabase/rollback/20261018123000_transportista_credifin_speed.sql
begin;
update public.transportistas set nombre = 'SPEED BUSINESS (Credifin)', razon_social = 'SPEED BUSINESS S. A.', cuit = '30686978350'
where id = '726fe24b-bd2c-46a9-96e9-b2e11b0d9fdb';
update public.transportes set transportista = 'SPEED BUSINESS (Credifin)'
where transportista_id = '726fe24b-bd2c-46a9-96e9-b2e11b0d9fdb';
commit;
