-- Vuelta atrás de 20261027140000_recibos_enviado.sql: saca la función y las dos columnas.
-- Los recibos no cambian; solo se pierde la marca «Enviado» de los que se mandaron desde que se corrió la migración.
drop function if exists public.marcar_recibo_enviado(uuid, uuid, text);
alter table public.recibos drop column if exists email_enviado_a;
alter table public.recibos drop column if exists email_enviado_at;
