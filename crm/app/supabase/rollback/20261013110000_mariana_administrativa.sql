-- Vuelta atrás de 20261013110000_mariana_administrativa.sql: Mariana vuelve a "admin".
begin;

select set_config('request.jwt.claims', '{"sub":"cb8fdf3e-d171-4042-9da7-248fe863b96d","role":"authenticated"}', true);
update public.profiles set role = 'admin', updated_at = now()
where id = '77f09508-eb3b-4779-83b5-1c7347003d88' and role = 'administrativo';

commit;
