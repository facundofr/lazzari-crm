-- Vuelta atrás de 20261028210000_mails_enviados.sql: saca la tabla de correos enviados.
-- Se pierde el registro de los mails y su estado (los mails ya mandados no cambian). Los envíos de PR anotados antes
-- de esta migración siguen en presupuesto_envios. Volver también el código a V1.1.607 (el PR lee de presupuesto_envios).
begin;
drop table if exists public.mails_enviados;
commit;
