-- Vuelta atrás de 20261029190500_mails_programados.sql.
-- Antes de usarla: cancelar en Correos enviados los mails que sigan "programado" (si no, Resend los manda igual).
-- Los programados y cancelados pasan a "enviado" para que entre la regla vieja (se pierde la marca de cancelado).
begin;

update public.mails_enviados set estado = 'enviado' where estado in ('programado', 'cancelado');
alter table public.mails_enviados drop constraint if exists mails_enviados_estado_check;
alter table public.mails_enviados add constraint mails_enviados_estado_check
  check (estado in ('enviado', 'entregado', 'rebotado', 'demorado', 'spam'));

commit;
