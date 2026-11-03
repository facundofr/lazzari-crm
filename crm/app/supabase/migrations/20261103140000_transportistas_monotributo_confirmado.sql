-- José Rodríguez y Cargiulo Angélica (Jm envíos - Javi en Transportes): Monotributo según sus Factura C del 02/11/2026.
-- OK de Augusto (03/11/2026, chat CRM). Solo cambia la ficha del proveedor en Lazzari. Aditivo.
-- José Rodríguez ya decía Monotributo "a confirmar": se confirma con su FC C 0002-00000384 (los datos bancarios siguen a confirmar).
-- Cargiulo Angélica decía RI y factura con C 00001-00000097: pasa a Monotributo.
-- Vuelta atrás: supabase/rollback/20261103140000_transportistas_monotributo_confirmado.sql
begin;
update public.proveedores
set notas = replace(notas, 'Condición de IVA y datos bancarios a confirmar.', 'Monotributo confirmado con su FC C 0002-00000384 (03/11/2026). Datos bancarios a confirmar.'),
    condicion_iva = 'Monotributo'
where id = '7c2e51a4-3b9d-4f60-a1d8-29102026b0c4' and cuit = '20313644074' and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021';

update public.proveedores
set condicion_iva = 'Monotributo',
    notas = concat_ws(' ', nullif(btrim(notas), ''), 'Monotributo según su FC C 00001-00000097 (03/11/2026; antes RI). En Transportes es Jm envíos - Javi.')
where id = '42bff233-a8c7-47a7-ae46-7bcf1f24fcde' and cuit = '27429325213' and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021'
  and condicion_iva = 'RI';
commit;
