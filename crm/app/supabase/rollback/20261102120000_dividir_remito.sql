-- Vuelta atrás de 20261102120000: saca la función (Dividir remito avisa que falta la función y no divide).
begin;
drop function if exists public.dividir_remito(uuid, uuid, jsonb);
commit;
