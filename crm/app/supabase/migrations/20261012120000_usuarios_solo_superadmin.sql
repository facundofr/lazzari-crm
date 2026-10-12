-- Usuarios: solo el super_admin (Augusto) maneja accesos (pedido de Augusto, 12/10/2026).
-- Arregla tres agujeros de las funciones/reglas hechas a mano por Manu:
--   1) handle_new_user tomaba el rol que mandaba quien se registraba (alguien podía crearse como super_admin).
--      Ahora todo usuario nuevo nace "viewer"; el rol real lo pone la invitación del CRM (que solo usa el super_admin).
--   2) La regla profiles_update_own deja que cada uno edite su ficha completa, incluido el rol.
--      Ahora un usuario logueado que no sea super_admin no puede cambiar rol, activo ni email de nadie (ni el propio);
--      su nombre y foto sí.
--   3) user_sociedades (a qué sociedad entra cada uno): solo el super_admin la puede cambiar.
-- El servidor del CRM (service_role) y el SQL Editor no tienen usuario logueado: siguen pudiendo
-- (el CRM controla en /api/invite y /api/users que quien pide sea super_admin).
-- Aditiva: reemplaza handle_new_user y agrega una función y dos disparadores. No toca datos.
-- Vuelta atrás: supabase/rollback/20261012120000_usuarios_solo_superadmin.sql
begin;

-- 1) Todo usuario nuevo nace "viewer"
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

-- ¿Quien hace el cambio es un super_admin activo? (sin usuario logueado = servidor o SQL Editor → sí)
create or replace function public.lz_puede_manejar_usuarios()
returns boolean
language sql
stable
security definer
set search_path to public
as $function$
  select auth.uid() is null
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'super_admin' and coalesce(p.active, true)
    );
$function$;

-- 2) Ficha de usuario: rol, activo y email solo los cambia el super_admin
create or replace function public.lz_proteger_profiles()
returns trigger
language plpgsql
security definer
set search_path to public
as $function$
begin
  if public.lz_puede_manejar_usuarios() then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
      or new.role is distinct from old.role
      or new.active is distinct from old.active
      or new.email is distinct from old.email then
      raise exception 'Solo el super admin puede cambiar el rol, el acceso o el email de un usuario';
    end if;
    return new;
  end if;
  raise exception 'Solo el super admin puede crear o borrar usuarios';
end;
$function$;

drop trigger if exists lz_proteger_profiles on public.profiles;
create trigger lz_proteger_profiles
  before insert or update or delete on public.profiles
  for each row execute function public.lz_proteger_profiles();

-- 3) Sociedades de cada usuario: solo el super_admin
create or replace function public.lz_proteger_user_sociedades()
returns trigger
language plpgsql
security definer
set search_path to public
as $function$
begin
  if not public.lz_puede_manejar_usuarios() then
    raise exception 'Solo el super admin puede cambiar a qué sociedades entra un usuario';
  end if;
  return coalesce(new, old);
end;
$function$;

drop trigger if exists lz_proteger_user_sociedades on public.user_sociedades;
create trigger lz_proteger_user_sociedades
  before insert or update or delete on public.user_sociedades
  for each row execute function public.lz_proteger_user_sociedades();

commit;
