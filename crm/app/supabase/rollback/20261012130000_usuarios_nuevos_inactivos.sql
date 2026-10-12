-- Vuelta atrás de 20261012130000_usuarios_nuevos_inactivos.sql
-- Deja handle_new_user como en 20261012120000 (usuario nuevo "viewer" pero activo). No toca datos.
begin;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  insert into public.profiles (id, full_name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
    new.email,
    'viewer'::public.user_role
  );
  return new;
end;
$function$;

commit;
