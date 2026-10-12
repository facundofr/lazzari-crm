-- Diagnóstico de usuarios (SOLO LECTURA: no cambia nada). 12/10/2026
-- Muestra quién tiene acceso al CRM, con qué rol y a qué sociedades,
-- y las reglas de la base que deciden quién puede cambiar un rol.

-- 1) Usuarios, rol y sociedades
select
  p.full_name                         as nombre,
  p.email,
  p.role                              as rol,
  p.active                            as activo,
  u.created_at::date                  as creado,
  u.last_sign_in_at::date             as ultimo_ingreso,
  coalesce(
    (select string_agg(s.nombre, ', ' order by s.nombre)
       from public.user_sociedades us
       join public.sociedades s on s.id = us.sociedad_id
      where us.user_id = p.id),
    'TODAS (sin restricción)')        as sociedades
from public.profiles p
left join auth.users u on u.id = p.id
order by p.role, p.full_name;

-- 2) Usuarios que existen para entrar pero NO tienen ficha en el CRM (no debería haber ninguno)
select u.email, u.created_at::date as creado, u.last_sign_in_at::date as ultimo_ingreso
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;

-- 3) Reglas de seguridad de la tabla de usuarios (profiles)
select policyname as regla, cmd as accion, qual as condicion, with_check as control
from pg_policies
where schemaname = 'public' and tablename = 'profiles';
