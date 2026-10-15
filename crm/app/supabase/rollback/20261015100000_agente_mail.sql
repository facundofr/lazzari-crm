-- Vuelta atrás de 20261015100000_agente_mail.sql: borra solo las 2 tablas nuevas del agente (no toca nada más).
begin;
drop table if exists public.agente_mail_corridas;
drop table if exists public.agente_mail_procesados;
commit;
