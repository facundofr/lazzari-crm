-- Pendientes de Augusto (lo pidió el 14/10/2026: "eso también lo ponemos en pendientes"). Solo agrega filas.
begin;
insert into public.pendientes (id, user_id, sociedad_id, texto, completado) values
  ('7b2e0d20-0001-4e00-9a00-000000000001', 'cb8fdf3e-d171-4042-9da7-248fe863b96d', 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021', 'Averiguar qué es cada DÉBITO DIRECTO del BBVA 091-312483/1 (7/10: $ 263.928,17 y $ 9.689,44; septiembre: 8 débitos)', false),
  ('7b2e0d20-0001-4e00-9a00-000000000002', 'cb8fdf3e-d171-4042-9da7-248fe863b96d', 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021', 'Cargar la factura C 00001-00000556 del contador Musso ($ 178.200) con "Cargar facturas (IA)"', false),
  ('7b2e0d20-0001-4e00-9a00-000000000003', 'cb8fdf3e-d171-4042-9da7-248fe863b96d', 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021', 'Pasar montos: mutual (Jero, Mariana, Seba, Augusto), monotributo (Jero, Mariana, Seba) y autónomos', false),
  ('7b2e0d20-0001-4e00-9a00-000000000004', 'cb8fdf3e-d171-4042-9da7-248fe863b96d', 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021', 'Pasar montos: seguro local, seguro auto, celulares, internet, luz, alarma', false),
  ('7b2e0d20-0001-4e00-9a00-000000000005', 'cb8fdf3e-d171-4042-9da7-248fe863b96d', 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021', 'Pasar montos: Google Drive, Netegia (baja pedida), Claude Team, Supabase', false),
  ('7b2e0d20-0001-4e00-9a00-000000000006', 'cb8fdf3e-d171-4042-9da7-248fe863b96d', 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021', 'IVA, Convenio Multilateral, Seg. e Higiene y SICORE: crear gastos fijos con día de vencimiento (subir VEP en Gastos)', false),
  ('7b2e0d20-0001-4e00-9a00-000000000007', 'cb8fdf3e-d171-4042-9da7-248fe863b96d', 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021', 'OK para gasto fijo: mantenimiento cuenta BBVA 091-339549/3 $ 34.000/mes (día 2)', false),
  ('7b2e0d20-0001-4e00-9a00-000000000008', 'cb8fdf3e-d171-4042-9da7-248fe863b96d', 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021', 'Pasar extractos de BNA y Galicia (para ver mantenimiento de cuenta)', false),
  ('7b2e0d20-0001-4e00-9a00-000000000009', 'cb8fdf3e-d171-4042-9da7-248fe863b96d', 'fee94607-747a-4e87-ba24-aff9032f7a56', 'Grupo LA: contador (nombre y monto) y gastos fijos', false)
on conflict (id) do nothing;
commit;
