-- SOLO LECTURA: no cambia nada. Diagnóstico de Finanzas (11/10/2026).
-- Devuelve una fila por control, con el detalle en JSON.
-- Uso: pegar todo en el SQL Editor de Supabase, Run, y Export > Download CSV.

with clientes_caso as (
  select c.id, c.razon_social, c.sociedad_id
  from public.clientes c
  where c.razon_social ilike '%del sol%' or c.razon_social ilike '%barraza%'
),
movs_futuros as (
  select m.*, (m.created_at at time zone 'America/Argentina/Buenos_Aires')::date as cargado_el
  from public.movimientos m
  where not coalesce(m.anulado, false)
    and m.fecha > (m.created_at at time zone 'America/Argentina/Buenos_Aires')::date + 1
)

select '01 clientes del caso' as control,
       (select jsonb_agg(to_jsonb(cc)) from clientes_caso cc) as detalle

union all
select '02 movimientos de esos clientes',
       (select jsonb_agg(to_jsonb(m) order by m.created_at desc)
          from public.movimientos m
         where m.cliente_id in (select id from clientes_caso))

union all
select '03 cheques de esos clientes',
       (select jsonb_agg(to_jsonb(e) order by e.created_at desc)
          from public.echeqs e
         where e.origen_id in (select id from clientes_caso)
            or e.origen_nombre ilike '%del sol%' or e.origen_nombre ilike '%barraza%')

union all
select '04 facturas y NC de esos clientes',
       (select jsonb_agg(jsonb_build_object(
                 'id', f.id, 'tipo', f.tipo, 'pv', f.punto_venta, 'numero', f.numero, 'fecha', f.fecha,
                 'total', f.total, 'moneda', f.moneda, 'estado', f.estado, 'cae', f.cae,
                 'total_acreditado', f.total_acreditado, 'factura_origen_id', f.factura_origen_id,
                 'cliente', cc.razon_social, 'sociedad_id', f.sociedad_id) order by f.fecha desc)
          from public.facturas f join clientes_caso cc on cc.id = f.cliente_id)

union all
select '05 solicitudes de cobro de esos clientes',
       (select jsonb_agg(jsonb_build_object('created_at', s.created_at, 'tipo', s.tipo, 'payload', s.payload) order by s.created_at desc)
          from public.cobro_solicitudes s
         where s.payload->>'cliente_id' in (select id::text from clientes_caso)
            or s.payload->>'factura_id' in (select f.id::text from public.facturas f where f.cliente_id in (select id from clientes_caso)))

union all
select '06 movimientos con fecha futura (resumen por tipo)',
       (select jsonb_agg(x) from (
          select tipo, count(*) as cantidad, sum(monto) as monto, sum(case when conciliado then 1 else 0 end) as conciliados
            from movs_futuros group by tipo order by tipo) x)

union all
select '07 movimientos con fecha futura (detalle, hasta 150)',
       (select jsonb_agg(x) from (
          select mf.id, mf.tipo, mf.fecha, mf.cargado_el, mf.monto, mf.moneda, mf.conciliado, mf.descripcion,
                 coalesce(c.razon_social, p.razon_social) as contraparte, mf.sociedad_id
            from movs_futuros mf
            left join public.clientes c on c.id = mf.cliente_id
            left join public.proveedores p on p.id = mf.proveedor_id
           order by mf.fecha desc limit 150) x)

union all
select '08 conciliados: por tipo, con y sin línea de extracto',
       (select jsonb_agg(x) from (
          select m.tipo,
                 count(*) filter (where m.conciliado) as conciliados,
                 count(*) filter (where m.conciliado and (to_jsonb(m)->>'extracto_movimiento_id') is not null) as con_extracto,
                 count(*) filter (where not m.conciliado) as pendientes
            from public.movimientos m
           where not coalesce(m.anulado, false)
           group by m.tipo order by m.tipo) x)

union all
select '09 funciones de cobro hechas a mano (código)',
       (select jsonb_agg(jsonb_build_object('funcion', p.proname, 'argumentos', pg_get_function_identity_arguments(p.oid), 'codigo', p.prosrc))
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.proname in ('registrar_cobro', 'registrar_cobro_masivo', 'gestionar_cobro'))

union all
select '10 inventario: funciones de public',
       (select jsonb_agg(p.proname order by p.proname)
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public')

union all
select '11 inventario: triggers',
       (select jsonb_agg(jsonb_build_object('tabla', c.relname, 'trigger', t.tgname, 'funcion', pr.proname) order by c.relname, t.tgname)
          from pg_trigger t
          join pg_class c on c.oid = t.tgrelid
          join pg_namespace n on n.oid = c.relnamespace
          join pg_proc pr on pr.oid = t.tgfoid
         where n.nspname = 'public' and not t.tgisinternal)

union all
select '12 inventario: reglas CHECK',
       (select jsonb_agg(jsonb_build_object('tabla', c.relname, 'regla', con.conname, 'definicion', pg_get_constraintdef(con.oid)) order by c.relname, con.conname)
          from pg_constraint con
          join pg_class c on c.oid = con.conrelid
          join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and con.contype = 'c')

union all
select '13 saldos de caja cargados a mano',
       (select jsonb_agg(to_jsonb(s) order by s.mes desc) from public.saldos_caja s)

union all
select '14 cheques recibidos: estados y fechas',
       (select jsonb_agg(x) from (
          select e.estado, e.tipo_cheque, count(*) as cantidad, sum(e.monto) as monto,
                 count(*) filter (where e.movimiento_id is null) as sin_cobro_vinculado,
                 count(*) filter (where e.fecha_pago < current_date and e.estado = 'en_cartera') as vencidos_en_cartera
            from public.echeqs e
           where coalesce(e.direccion, 'recibido') = 'recibido'
           group by e.estado, e.tipo_cheque order by e.estado) x);
