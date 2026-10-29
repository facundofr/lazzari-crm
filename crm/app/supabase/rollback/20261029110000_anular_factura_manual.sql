-- Vuelta atrás de 20261029110000: saca la función (la pantalla avisa "falta la migración" si se usa sin ella).
-- Los ajustes a favor que ya haya creado quedan (son datos: se anulan desde la ficha del cliente si hace falta).
begin;
drop function if exists public.gestionar_factura_manual(uuid, text);
commit;
