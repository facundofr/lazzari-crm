-- Estado de cada usuario (SOLO LECTURA: no cambia nada). 12/10/2026
select
  coalesce(p.full_name, u.email)               as nombre,
  u.email,
  coalesce(p.role::text, 'SIN FICHA')          as rol,
  case
    when u.banned_until > now() then 'BLOQUEADO (no puede entrar)'
    when p.id is null then 'SIN FICHA (no puede entrar)'
    when p.active = false then 'INACTIVO (no puede entrar)'
    when u.email_confirmed_at is null then 'INVITADO, nunca aceptó'
    else 'PUEDE ENTRAR'
  end                                          as estado,
  coalesce(
    (select string_agg(s.nombre, ', ' order by s.nombre)
       from public.user_sociedades us
       join public.sociedades s on s.id = us.sociedad_id
      where us.user_id = u.id),
    'TODAS')                                   as sociedades,
  u.last_sign_in_at::date                      as ultimo_ingreso
from auth.users u
left join public.profiles p on p.id = u.id
order by estado, rol, nombre;
