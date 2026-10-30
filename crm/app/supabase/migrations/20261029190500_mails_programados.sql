-- Mails programados (Augusto 29/10/2026, Cobranzas: "me gustaria poder programarlo para que se envie mañana a la hora
-- que yo quiera, como se hace en gmail"). Un mail de Correos enviados puede quedar "programado" (Resend lo manda a la
-- hora elegida; enviado_at = cuándo sale) o "cancelado" (se canceló antes de salir).
-- Solo AGREGA dos valores posibles al estado: no cambia ni borra nada de lo que ya existe.
-- Vuelta atrás: supabase/rollback/20261029190500_mails_programados.sql
begin;

alter table public.mails_enviados drop constraint if exists mails_enviados_estado_check;
alter table public.mails_enviados add constraint mails_enviados_estado_check
  check (estado in ('enviado', 'entregado', 'rebotado', 'demorado', 'spam', 'programado', 'cancelado'));

commit;

-- Prueba (tiene que dar true):
-- select pg_get_constraintdef(oid) like '%programado%' and pg_get_constraintdef(oid) like '%cancelado%'
-- from pg_constraint where conname = 'mails_enviados_estado_check';
