-- Prueba de 20261103210000: 9 pestañas por sociedad, sin línea elegida (regla de siempre), checks sacados, gastos sin tocar.
select
  (select count(*) from public.gastos_grupos) as pestanas,
  (select count(*) from public.gastos_grupos where linea is not null) as con_linea,
  (select string_agg(s.nombre || ': ' || x.n, ', ') from (select sociedad_id, count(*) n from public.gastos_grupos group by 1) x join public.sociedades s on s.id = x.sociedad_id) as por_sociedad,
  (select string_agg(nombre, ' · ' order by orden) from public.gastos_grupos where sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021') as orden_lazzari,
  (select count(*) from pg_constraint where conname in ('gastos_manuales_grupo_check', 'gastos_fijos_grupo_check')) as checks_que_quedan,
  (select count(*) from public.gastos_manuales) as gastos;
