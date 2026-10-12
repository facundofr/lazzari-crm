-- Baja de Manu (manu@lazzari.com.ar), 12/10/2026, con OK de Augusto. Ya no trabaja en el proyecto.
-- NO se borra (queda su historial): sin entrada, inactivo y con rol "viewer".
-- Vuelta atrás: banned_until = null, active = true y el rol que muestra la columna rol_anterior.
begin;

-- Antes (anotar rol_anterior por si hay que volver atrás)
select p.email, p.role as rol_anterior, p.active as activo_anterior
from public.profiles p
join auth.users u on u.id = p.id
where lower(u.email) = 'manu@lazzari.com.ar';

update public.profiles
set active = false, role = 'viewer'
where id = (select id from auth.users where lower(email) = 'manu@lazzari.com.ar');

update auth.users
set banned_until = now() + interval '100 years'
where lower(email) = 'manu@lazzari.com.ar';

-- Después: 1 fila, activo false y bloqueado dentro de 100 años
select p.email, p.role as rol, p.active as activo, u.banned_until::date as bloqueado_hasta
from public.profiles p
join auth.users u on u.id = p.id
where lower(u.email) = 'manu@lazzari.com.ar';

commit;
