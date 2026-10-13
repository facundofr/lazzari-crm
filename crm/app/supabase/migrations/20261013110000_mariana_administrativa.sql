-- Mariana pasa de "admin" a "administrativo" — 13/10/2026, con OK de Augusto.
-- Correr DESPUÉS de 20261013100000_permisos_por_rol.sql y de publicar V1.1.425 (que le da al rol administrativo lo que ella usa).
-- El control de profiles solo deja cambiar roles al super_admin: se hace en nombre de Augusto.
-- Vuelta atrás: supabase/rollback/20261013110000_mariana_administrativa.sql (o, desde el CRM, Configuración > Usuarios > Rol).
begin;

select set_config('request.jwt.claims', '{"sub":"cb8fdf3e-d171-4042-9da7-248fe863b96d","role":"authenticated"}', true);
update public.profiles set role = 'administrativo', updated_at = now()
where id = '77f09508-eb3b-4779-83b5-1c7347003d88' and role = 'admin';

commit;
