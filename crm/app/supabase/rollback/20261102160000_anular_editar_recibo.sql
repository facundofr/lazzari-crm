-- Vuelta atrás de 20261102160000_anular_editar_recibo.sql: saca las dos funciones nuevas.
-- No toca datos: los cobros que ya se anularon o editaron quedan como están (anulados, no borrados).
-- Después de correrla, los botones Anular y Editar de Finanzas > Recibos avisan que falta la migración y no hacen nada.
begin;
drop function if exists public.anular_recibo(uuid, text);
drop function if exists public.editar_recibo(uuid, date, jsonb);
commit;
