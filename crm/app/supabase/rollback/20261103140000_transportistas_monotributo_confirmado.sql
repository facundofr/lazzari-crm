-- Vuelta atrás de 20261103140000_transportistas_monotributo_confirmado.sql
begin;
update public.proveedores
set notas = replace(notas, 'Monotributo confirmado con su FC C 0002-00000384 (03/11/2026). Datos bancarios a confirmar.', 'Condición de IVA y datos bancarios a confirmar.')
where id = '7c2e51a4-3b9d-4f60-a1d8-29102026b0c4' and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021';

update public.proveedores
set condicion_iva = 'RI',
    notas = nullif(btrim(replace(notas, 'Monotributo según su FC C 00001-00000097 (03/11/2026; antes RI). En Transportes es Jm envíos - Javi.', '')), '')
where id = '42bff233-a8c7-47a7-ae46-7bcf1f24fcde' and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021';
commit;
