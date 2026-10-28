-- Prueba de 20261028185000_dashboard_conversion_ganados.sql (solo lectura). Las 3 filas tienen que dar ok = true.
with f as (
  select s.nombre, s.id,
         (public.get_dashboard_kpis(s.id)->>'tasa_conversion')::numeric as tasa,
         (public.get_dashboard_kpis(s.id)->>'presupuestos_activos')::int as activos
  from (values ('Lazzari', 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021'::uuid),
               ('Grupo LA', 'fee94607-747a-4e87-ba24-aff9032f7a56'::uuid)) s(nombre, id)
),
e as (
  select f.nombre,
         coalesce(round(count(*) filter (where p.estado::text in ('aprobado','facturar','facturado','remitido','entregado'))::numeric
           / nullif(count(*) filter (where p.estado::text in ('aprobado','facturar','facturado','remitido','entregado',
                                                         'rechazado','vencido','postergado','cancelada','cancelado')), 0) * 100, 1), 0) as esperada
  from f left join public.presupuestos p
    on p.sociedad_id = f.id and not coalesce(p.eliminado, false)
   and p.fecha >= date_trunc('month', (now() at time zone 'America/Argentina/Buenos_Aires')::date) - interval '3 months'
  group by f.nombre
)
select f.nombre || ': conversión ' || f.tasa || ' % (esperada ' || e.esperada || ' %)' as prueba, f.tasa = e.esperada as ok
from f join e using (nombre)
union all
select 'PR en la Papelera fuera de activos', not exists (
  select 1 from f
  where f.activos <> (select count(*) from public.presupuestos p
                      where p.sociedad_id = f.id and p.estado in ('borrador','pendiente','postergado')
                        and not coalesce(p.eliminado, false))
);
