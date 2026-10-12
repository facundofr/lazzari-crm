-- Vuelta atrás de baja_laura_12_10_2026.sql: le devuelve el acceso a Laura.
-- Cambiá 'vendedor' por el rol que tenía antes (lo mostró el primer resultado de la baja).
begin;

update auth.users
set banned_until = null
where lower(email) = 'laura@lazzari.com.ar';

update public.profiles
set active = true, role = 'vendedor'
where id = (select id from auth.users where lower(email) = 'laura@lazzari.com.ar');

commit;
