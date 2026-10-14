-- Gastos fijos de Lazzari (OK de Augusto 14/10/2026): contador, alquiler y 3 sueldos. Solo agrega filas.
begin;
insert into public.gastos_fijos (id, sociedad_id, descripcion, categoria, monto, moneda, activo, notas, proveedor_id) values
  ('6a1f0c10-0001-4e00-9a00-000000000001', 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021', 'Honorarios contador (Agustín Musso)', 'Profesionales', 178200, 'ARS', true,
   'Factura C mensual (honorarios del mes anterior)', '929a45f6-a81e-4972-a056-cb3ce24a9556'),
  ('6a1f0c10-0001-4e00-9a00-000000000002', 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021', 'Alquiler', 'Alquiler', 800, 'USD', true,
   'Del 1 al 15. En US$ billete: se compra dólar blue en financiera (TC lo carga Augusto)', null),
  ('6a1f0c10-0001-4e00-9a00-000000000003', 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021', 'Sueldo Mariana Santinelli', 'Sueldos', 1500000, 'ARS', true, 'Del 1 al 10', null),
  ('6a1f0c10-0001-4e00-9a00-000000000004', 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021', 'Sueldo Jerónimo Casadidio', 'Sueldos', 1500000, 'ARS', true, 'Del 1 al 10', null),
  ('6a1f0c10-0001-4e00-9a00-000000000005', 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021', 'Sueldo Sebastián Pereyra', 'Sueldos', 1500000, 'ARS', true, 'Del 1 al 10', null)
on conflict (id) do nothing;
commit;
