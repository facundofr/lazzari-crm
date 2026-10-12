-- José Alvarez (jose@lazzari.com.ar), 12/10/2026, con OK de Augusto.
-- Es vendedor pero no usa el sistema: se le bloquea SOLO la entrada. Su ficha queda igual (activo, vendedor),
-- así sigue apareciendo para asignarle presupuestos y ventas.
-- Vuelta atrás: update auth.users set banned_until = null where lower(email) = 'jose@lazzari.com.ar';
begin;

update auth.users
set banned_until = now() + interval '100 years'
where lower(email) = 'jose@lazzari.com.ar';

-- Tiene que dar 1 fila: rol vendedor, activo true y bloqueado dentro de 100 años
select p.full_name, p.email, p.role as rol, p.active as activo, u.banned_until::date as entrada_bloqueada_hasta
from auth.users u
join public.profiles p on p.id = u.id
where lower(u.email) = 'jose@lazzari.com.ar';

commit;
