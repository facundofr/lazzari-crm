-- Prueba de 20261026120000_anular_pago_doble_serenplas.sql (se corre con --probar: muestra resultados y DESHACE todo).
with fc as (
  select coalesce(sum(total), 0) as facturas from public.facturas_compra
  where proveedor_id = 'd4485d80-7bc9-419c-8cfd-6ebb10aa7f5e' and moneda = 'ARS'
), mv as (
  select coalesce(sum(monto) filter (where tipo = 'pago'), 0) as pagos, coalesce(sum(monto) filter (where tipo = 'retencion_ganancias'), 0) as retenciones
  from public.movimientos where proveedor_id = 'd4485d80-7bc9-419c-8cfd-6ebb10aa7f5e' and not coalesce(anulado, false)
)
select 'SERENPLAS: facturas de compra' as control, to_char(facturas, 'FM999G999G990D00') as valor, 'esperado 324.599,84' as nota from fc
union all select 'SERENPLAS: pagos activos', to_char(pagos, 'FM999G999G990D00'), 'esperado 323.714,55 (antes 392.450,75)' from mv
union all select 'SERENPLAS: retenciones activas', to_char(retenciones, 'FM999G999G990D00'), 'esperado 885,29 (antes 1.770,58)' from mv
union all select 'SERENPLAS: pagado de más', to_char(pagos + retenciones - facturas, 'FM999G999G990D00'), 'esperado 0,00 (antes 69.621,49)' from mv, fc
union all select 'par viejo del 15/09 anulado', count(*)::text, 'esperado 2'
  from public.movimientos where id in ('1037a979-f842-4524-9ccf-33e1c2bfc34a', '44942db9-d8f4-4605-900b-6440fc9ae48f') and anulado
union all select 'par de la OP-000014 activo', count(*)::text, 'esperado 2'
  from public.movimientos where orden_pago_id = 'e55fb27c-ae24-4ac0-a2c9-520a1ab4208d' and not coalesce(anulado, false)
union all select 'OP-000014 sigue pagada', estado, 'esperado pagada' from public.ordenes_pago where numero = 'OP-000014'
union all select 'eCheq 90017313 sin cambios', estado, 'esperado entregado' from public.echeqs where numero = '90017313';
