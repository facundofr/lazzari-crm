-- Prueba de 20261027150000_op_retencion_congelada.sql (se corre con --probar: muestra resultados y DESHACE todo).
-- Simula a Augusto (con los permisos de la app, no los de administrador de la base) y anota la retención en la OP-000049
-- y en un pago de Lazzari, como lo hará la ventana de OP.
select 'columnas nuevas' as control, count(*)::text as valor, 'esperado 8' as nota
  from information_schema.columns where table_schema = 'public' and table_name in ('ordenes_pago', 'movimientos')
   and column_name in ('retencion_ganancias_regimen', 'retencion_ganancias_minimo', 'retencion_ganancias_base_previa', 'retencion_ganancias_retenido_antes')
union all select 'OP anotadas antes de la prueba', count(*)::text, 'esperado 0'
  from public.ordenes_pago where retencion_ganancias_regimen is not null;

select set_config('request.jwt.claims', '{"sub":"cb8fdf3e-d171-4042-9da7-248fe863b96d","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', 'cb8fdf3e-d171-4042-9da7-248fe863b96d', true);
set local role authenticated;

update public.ordenes_pago
   set retencion_ganancias_regimen = '078', retencion_ganancias_minimo = 224000, retencion_ganancias_base_previa = 48560.86, retencion_ganancias_retenido_antes = 0
 where sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and numero = 'OP-000049';

update public.movimientos
   set retencion_ganancias_regimen = '094', retencion_ganancias_minimo = 67170, retencion_ganancias_base_previa = 0, retencion_ganancias_retenido_antes = 0
 where id = (select id from public.movimientos
              where sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and tipo = 'pago' and factura_compra_id is not null
                and not coalesce(anulado, false) and coalesce(moneda, 'ARS') = 'ARS'
              order by created_at desc limit 1);

reset role;

select 'OP-000049 anotada con los permisos de la app' as control,
       retencion_ganancias_regimen || ' · mínimo ' || retencion_ganancias_minimo || ' · antes ' || retencion_ganancias_base_previa || ' · retenido antes ' || retencion_ganancias_retenido_antes as valor,
       'esperado 078 · mínimo 224000.00 · antes 48560.86 · retenido antes 0.00' as nota
  from public.ordenes_pago where sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and numero = 'OP-000049'
union all select 'pagos anotados con los permisos de la app', count(*)::text, 'esperado 1'
  from public.movimientos where retencion_ganancias_regimen is not null
union all select 'OP-000049: lo demás no cambia', monto_bruto || ' · ' || retencion_ganancias_monto || ' · ' || estado, 'esperado 323353.35 · 1835.90 · pagada'
  from public.ordenes_pago where sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and numero = 'OP-000049';

-- Un régimen que no es un código de 3 dígitos se rechaza.
do $$
begin
  update public.ordenes_pago set retencion_ganancias_regimen = '78' where numero = 'OP-000049';
  raise exception 'FALLA: aceptó un régimen de 2 dígitos';
exception when check_violation then null;
end $$;
select 'régimen mal escrito' as control, 'rechazado' as valor, 'esperado rechazado' as nota;
