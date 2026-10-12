-- Vuelta atrás de 20261012120000_usuarios_solo_superadmin.sql
-- Saca los dos disparadores y sus funciones, y deja handle_new_user como la había hecho Manu.
-- No toca datos.
begin;

drop trigger if exists lz_proteger_profiles on public.profiles;
drop trigger if exists lz_proteger_user_sociedades on public.user_sociedades;
drop function if exists public.lz_proteger_profiles();
drop function if exists public.lz_proteger_user_sociedades();
drop function if exists public.lz_puede_manejar_usuarios();

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
    coalesce(
      (new.raw_user_meta_data ->> 'role')::public.user_role,
      'viewer'::public.user_role
    )
  );
  return new;
end;
$function$;

commit;
