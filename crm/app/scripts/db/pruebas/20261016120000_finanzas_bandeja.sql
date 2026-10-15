-- Prueba de 20261016120000_finanzas_bandeja (se deshace siempre).
select to_regclass('public.finanzas_propuestas') is not null as tabla_propuestas,
       to_regclass('public.finanzas_registro') is not null as tabla_registro,
       to_regprocedure('public.pagar_gasto_desde_extracto(uuid,uuid,uuid)') is not null as funcion_pagar_gasto,
       (select count(*) from public.finanzas_registro) as filas_registro;
