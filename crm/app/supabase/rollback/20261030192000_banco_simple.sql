-- Vuelta atrás de 20261030192000_banco_simple.sql: saca las 2 funciones. Lo que ya procesó el motor queda (cada línea se puede
-- desatar antes con deshacer_banco; el registro queda en finanzas_registro; los avisos que dejó en la campana quedan).
begin;
drop function if exists public.deshacer_banco(uuid, uuid, uuid);
drop function if exists public.procesar_banco(uuid, jsonb);
commit;
