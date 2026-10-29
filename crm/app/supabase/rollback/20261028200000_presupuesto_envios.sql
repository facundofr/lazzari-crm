-- Vuelta atrás de 20261028200000_presupuesto_envios.sql: saca la tabla de envíos por mail de los PR.
-- Se pierde el registro de quién y cuándo mandó cada PR (los mails ya mandados no cambian). Los PR quedan como están.
begin;
drop table if exists public.presupuesto_envios;
commit;
