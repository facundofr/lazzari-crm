-- Vuelta atrás de 20261016120000_finanzas_bandeja.sql: borra solo lo nuevo de la bandeja (no toca nada más).
-- Los pagos de gastos que se hayan confirmado desde la bandeja quedan (son movimientos normales: se anulan desde Movimientos).
begin;
drop function if exists public.pagar_gasto_desde_extracto(uuid, uuid, uuid);
drop table if exists public.finanzas_registro;
drop table if exists public.finanzas_propuestas;
commit;
