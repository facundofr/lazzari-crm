-- Vuelta atrás de 20261014100000_datos_gastos_fijos_lazzari.sql: saca solo las 5 filas que agregó (por id).
begin;
delete from public.gastos_fijos where id in (
  '6a1f0c10-0001-4e00-9a00-000000000001', '6a1f0c10-0001-4e00-9a00-000000000002', '6a1f0c10-0001-4e00-9a00-000000000003',
  '6a1f0c10-0001-4e00-9a00-000000000004', '6a1f0c10-0001-4e00-9a00-000000000005');
commit;
