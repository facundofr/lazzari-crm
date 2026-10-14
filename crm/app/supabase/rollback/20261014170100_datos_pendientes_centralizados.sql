-- Vuelta atrás de 20261014170100: saca los pendientes agregados, limpia área/tipo/link de los 9 viejos y reabre MARIANA SA en Revisar.
begin;
delete from public.pendientes where id::text like '7b2e0d20-0002-4e00-9a00-%';
update public.pendientes set area = null, link = null, tipo = 'hacer' where id::text like '7b2e0d20-0001-4e00-9a00-%';
update public.finanzas_revisar set estado = 'pendiente', resolucion = null, resuelto_at = null
where id = 'e0cf1daf-c3e8-49cc-af2a-d5a51c3ab061' and resolucion like '%Cerrado desde Pendientes 14/10/2026%';
commit;
