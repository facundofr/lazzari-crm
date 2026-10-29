-- Vuelta atrás de 20261029100000: saca las dos funciones (la pantalla vuelve a avisar "falta la migración" si se usa sin ellas).
begin;
drop function if exists public.crear_gasto_con_pago(uuid, jsonb, text);
drop function if exists public.borrar_gasto(uuid);
commit;
