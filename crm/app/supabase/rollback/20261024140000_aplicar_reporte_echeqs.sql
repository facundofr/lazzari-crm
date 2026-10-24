-- Vuelta atrás de 20261024140000_aplicar_reporte_echeqs.sql
-- Borra la función aplicar_reporte_echeqs. No toca ningún cheque (los cheq_id y estado_banco ya guardados quedan; se sacan con el rollback de sus columnas).
begin;

drop function if exists public.aplicar_reporte_echeqs(uuid, jsonb);

commit;
