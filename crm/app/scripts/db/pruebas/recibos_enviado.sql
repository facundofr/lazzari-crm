-- Prueba de 20261027140000_recibos_enviado.sql (se corre con --probar: muestra resultados y DESHACE todo).
-- Simula a Augusto y marca como enviado el último recibo de Lazzari.
select set_config('request.jwt.claims', '{"sub":"cb8fdf3e-d171-4042-9da7-248fe863b96d","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', 'cb8fdf3e-d171-4042-9da7-248fe863b96d', true);

select 'columnas nuevas en recibos' as control, count(*)::text as valor, 'esperado 2' as nota
  from information_schema.columns where table_schema = 'public' and table_name = 'recibos' and column_name in ('email_enviado_at', 'email_enviado_a')
union all select 'recibos marcados antes de la prueba', count(*)::text, 'esperado 0'
  from public.recibos where email_enviado_at is not null
union all select 'recibos en total', count(*)::text, 'no cambia'
  from public.recibos;

select public.marcar_recibo_enviado(
  (select id from public.recibos where sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' order by numero desc limit 1),
  'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021', ' cliente@ejemplo.com, otro@ejemplo.com ') is not null as marcado;

select 'recibo marcado' as control,
       numero::text || ' · ' || to_char(email_enviado_at at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY HH24:MI') || ' · ' || email_enviado_a as valor,
       'esperado el último N° de Lazzari, ahora y los dos mails' as nota
  from public.recibos where email_enviado_at is not null;

-- Un recibo de otra sociedad no se marca con la de Lazzari.
do $$
begin
  perform public.marcar_recibo_enviado(
    (select id from public.recibos where sociedad_id = 'fee94607-747a-4e87-ba24-aff9032f7a56' order by numero desc limit 1),
    'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021', null);
  raise exception 'FALLA: marcó un recibo de otra sociedad';
exception when others then
  if sqlerrm not like 'El recibo no es de esta sociedad%' then raise; end if;
end $$;
select 'recibo de Grupo LA con la sociedad Lazzari' as control, 'no se marcó' as valor, 'esperado no se marcó' as nota;
