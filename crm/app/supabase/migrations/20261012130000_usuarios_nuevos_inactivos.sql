-- Nadie entra al CRM sin invitación de Augusto, ni siquiera a mirar (pedido de Augusto, 12/10/2026).
-- Todo usuario nuevo nace INACTIVO ("viewer", active = false). La invitación del CRM (/api/invite, solo super_admin)
-- lo activa con el rol elegido. Un usuario creado por otro camino (registro público, panel de Supabase)
-- queda inactivo y el CRM no lo deja entrar (middleware: sin ficha o inactivo → afuera).
-- Aditiva: solo reemplaza handle_new_user. No toca datos.
-- Vuelta atrás: supabase/rollback/20261012130000_usuarios_nuevos_inactivos.sql
begin;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  insert into public.profiles (id, full_name, email, role, active)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
    new.email,
    'viewer'::public.user_role,
    false
  );
  return new;
end;
$function$;

commit;
