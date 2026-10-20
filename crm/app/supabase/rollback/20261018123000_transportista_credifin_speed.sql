-- Vuelta atrás de 20261018123000_transportista_credifin_speed.sql (valores del 18/10/2026).
begin;
update public.transportistas set nombre = 'CREDIFIN', razon_social = null, cuit = null where id = '726fe24b-bd2c-46a9-96e9-b2e11b0d9fdb';
update public.transportes set transportista = 'Credifin' where id in ('961327b9-de9d-4fc7-aecc-e3be32eb87ce','10293d86-bd61-4257-87d3-ca6a276dcf96','8d288b5d-3430-4ca0-8b5d-fc3044014aed');
update public.transportes set transportista = 'CREDIFIN' where id in ('29c95e5c-cadf-4030-8478-5b7e201f5057','cf9cc17e-e386-4d14-bc6e-405fd986d801','08c87307-b38a-417e-9a06-524e1fc7bbac','9f91d7dd-98e9-4c15-aa60-0d8a6efe9c63','33a33f63-744a-4838-a2d6-caa3113351b6','952a05dc-45d4-4b38-bcbc-23c2fc7a3767','11ad2806-6bc7-403f-a0dc-e2726f7d7644');
commit;
