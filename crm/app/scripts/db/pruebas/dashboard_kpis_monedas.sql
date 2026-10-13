select 'Lazzari' soc, public.get_dashboard_kpis('eee2a3c8-fe6c-494d-bd2f-7a5d8067d021')::text k
union all
select 'Grupo LA', public.get_dashboard_kpis('fee94607-747a-4e87-ba24-aff9032f7a56')::text;
