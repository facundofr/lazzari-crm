-- Vuelta atrás de 20261017100000_ia_acciones.sql: saca la tabla del historial del asistente
-- (se pierde la lista "Lo que hizo la IA" y su Deshacer; los cambios ya hechos quedan como están).
begin;
drop table if exists public.ia_acciones;
commit;
