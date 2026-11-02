-- Vuelta atrás de 20261102200000_tarjeta_consumos.sql: saca los consumos de la tarjeta renglón por renglón.
-- Se pierden los consumos guardados, la clase de cada comercio y las facturas / «No tiene» marcadas en los consumos.
-- No toca los resúmenes (tarjeta_resumenes), ni facturas, movimientos o pagos.
begin;
drop function if exists public.consumos_de_tarjeta(uuid, uuid);
drop function if exists public.marcar_consumo_tarjeta(uuid, uuid, text);
drop function if exists public.clasificar_consumo_tarjeta(uuid, text, text, uuid);
drop function if exists public.guardar_consumos_tarjeta(uuid, jsonb);
drop table if exists public.tarjeta_consumos;
drop table if exists public.tarjeta_comercios;
commit;
