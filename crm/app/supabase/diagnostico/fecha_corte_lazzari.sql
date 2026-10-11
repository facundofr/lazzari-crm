-- Solo lectura: primer día con datos de Lazzari en el sistema (para la fecha de corte de Cuentas).
-- "primera_carga" = cuándo se cargó en el sistema; "primera_fecha" = la fecha que dice el documento.
with s as (select 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021'::uuid as id)
select 'presupuestos' as tabla, count(*) as cantidad, min(created_at)::date as primera_carga, null::date as primera_fecha
  from public.presupuestos where sociedad_id = (select id from s)
union all
select 'ordenes_compra', count(*), min(created_at)::date, null
  from public.ordenes_compra where sociedad_id = (select id from s)
union all
select 'facturas', count(*), min(created_at)::date, min(fecha)::date
  from public.facturas where sociedad_id = (select id from s)
union all
select 'movimientos (cobros/pagos)', count(*), min(created_at)::date, min(fecha)::date
  from public.movimientos where sociedad_id = (select id from s)
union all
select 'cheques', count(*), min(created_at)::date, null
  from public.echeqs where sociedad_id = (select id from s)
order by primera_carga;
