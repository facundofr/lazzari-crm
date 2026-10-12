-- Baja de Laura (laura@lazzari.com.ar), 12/10/2026, con OK de Augusto.
-- NO se borra: cargó 1 movimiento y tiene 15 registros de actividad, y borrarla perdería quién los hizo.
-- Queda sin acceso (bloqueada para entrar) y marcada inactiva, con rol "viewer".
-- Vuelta atrás: baja_laura_12_10_2026_vuelta_atras.sql
begin;

-- Antes: cómo estaba (anotar el rol por si hay que volver atrás)
select p.email, p.role as rol_anterior, p.active as activo_anterior
from public.profiles p
where lower(p.email) = 'laura@lazzari.com.ar';

update public.profiles
set active = false, role = 'viewer'
where id = (select id from auth.users where lower(email) = 'laura@lazzari.com.ar');

update auth.users
set banned_until = now() + interval '100 years'
where lower(email) = 'laura@lazzari.com.ar';

-- Después: tiene que dar 1 fila, activo = false y bloqueada_hasta dentro de 100 años
select p.email, p.role, p.active as activo, u.banned_until::date as bloqueada_hasta
from public.profiles p
join auth.users u on u.id = p.id
where lower(u.email) = 'laura@lazzari.com.ar';

commit;
