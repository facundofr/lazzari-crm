-- Vuelta atrás de 20261102120100_factura_manual_una_operacion.sql: saca la función. No toca facturas.
-- Ojo: con la versión publicada que la usa, la factura manual deja de guardarse hasta volver también el código anterior.
begin;

revoke all on function public.registrar_factura_manual(jsonb, jsonb) from authenticated;
drop function if exists public.registrar_factura_manual(jsonb, jsonb);

commit;
