-- Vuelta atrás de 20261030120000_cobro_y_saldo_favor_juntos.sql: saca la función.
-- Cobrar vuelve solo a los dos pasos de antes (primero el saldo a favor, después el cobro). Los cobros ya guardados quedan como están.
drop function if exists public.registrar_cobro_con_saldo_favor(uuid, jsonb, jsonb, jsonb, date, uuid, uuid, jsonb, numeric, text);
