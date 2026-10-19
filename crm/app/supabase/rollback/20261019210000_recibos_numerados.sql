-- Vuelta atrás de 20261019210000_recibos_numerados.sql: saca solo lo que agregó esa migración.
-- No toca ningún movimiento (los cobros quedan igual; solo se pierde la numeración de los recibos).
begin;
drop trigger if exists asignar_recibo_movimiento on public.movimientos;
drop function if exists public.asignar_recibo_movimiento();
drop table if exists public.recibo_movimientos;
drop table if exists public.recibos;
drop function if exists public.es_movimiento_de_recibo(public.movimientos);
commit;
