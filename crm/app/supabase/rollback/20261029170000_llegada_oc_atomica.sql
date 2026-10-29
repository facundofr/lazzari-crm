-- Vuelta atrás de 20261029170000: saca la función (la pantalla Llegó vuelve sola al guardado de antes, renglón por renglón).
begin;
drop function if exists public.registrar_llegada_oc(uuid, uuid, jsonb, text);
commit;
