-- Vuelta atrás de 20261012110000_cobro_diferencia_cc.sql
-- Solo borra la función nueva. Los cobros que ya se hayan guardado con ella quedan como están
-- (para revertir uno, anular sus movimientos desde Finanzas).
begin;
drop function if exists public.registrar_cobro_masivo_diferencia_cc(uuid, jsonb, jsonb, jsonb, date, uuid, uuid, numeric, text);
commit;
