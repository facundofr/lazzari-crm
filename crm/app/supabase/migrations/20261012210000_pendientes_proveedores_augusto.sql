-- Pendientes de Augusto sobre proveedores, como checklist en Finanzas > Hoy > Revisar (pedido de Augusto, 12/10/2026).
-- Solo agrega 5 filas en finanzas_revisar (Lazzari), con aviso en la campana el 13/10. Se marcan "Resuelto" desde la pantalla.
-- Vuelta atrás: supabase/rollback/20261012210000_pendientes_proveedores_augusto.sql
begin;

insert into finanzas_revisar (sociedad_id, entidad_tipo, titulo, motivo, nota, recordar_el, created_by) values
('eee2a3c8-fe6c-494d-bd2f-7a5d8067d021', 'otro', 'Proveedores: completar el Excel de vendedores (WhatsApp y mail)', 'falta_cargar',
 'Archivo: Claude outputs/proveedores_datos_faltantes_12_10_2026.xlsx. 48 de 51 proveedores con OC no tienen vendedor. Pasárselo a Claude para que cargue los contactos "Ventas". También: 27 sin mail de administración y 10 sin CBU.',
 '2026-10-13', 'cb8fdf3e-d171-4042-9da7-248fe863b96d'),
('eee2a3c8-fe6c-494d-bd2f-7a5d8067d021', 'otro', 'Proveedores: dar de alta ESLINGAR (es "Delta Plus" en la lista de costos)', 'falta_cargar',
 'Cargarlo en Proveedores con el CUIT (la IA completa el resto). Después avisarle a Claude para vincularlo con "Delta Plus".',
 '2026-10-13', 'cb8fdf3e-d171-4042-9da7-248fe863b96d'),
('eee2a3c8-fe6c-494d-bd2f-7a5d8067d021', 'otro', 'Proveedores: dar de alta MARIANA SA (es "Pegaso" en la lista de costos)', 'falta_cargar',
 'Cargarlo en Proveedores con el CUIT. Después avisarle a Claude para vincularlo con "Pegaso".',
 '2026-10-13', 'cb8fdf3e-d171-4042-9da7-248fe863b96d'),
('eee2a3c8-fe6c-494d-bd2f-7a5d8067d021', 'otro', 'Proveedores: ¿quién es Ecoway? ¿y Fravida?', 'otro',
 'Pasarle a Claude la razón social o el CUIT de Ecoway y confirmar Fravida, para vincularlos con la lista de costos.',
 '2026-10-13', 'cb8fdf3e-d171-4042-9da7-248fe863b96d'),
('eee2a3c8-fe6c-494d-bd2f-7a5d8067d021', 'otro', 'Proveedores: talleres de personalización (Nora, Eve, Cordobés)', 'falta_cargar',
 'Conseguir CUIT y documento de cada taller. Nora = bordado; Eve y Cordobés = estampado. La personalización desde el PR se hace después de arreglar lo roto.',
 '2026-10-13', 'cb8fdf3e-d171-4042-9da7-248fe863b96d');

commit;
