-- Vuelta atras de 20261029120000_mateo_perrone_monotributo_confirmado.sql
begin;
update public.proveedores
set notas = replace(notas, 'Monotributo confirmado con su FC C 00001-00000098 (29/10/2026).', 'Condición de IVA a confirmar con su factura.')
where cuit = '20452221951' and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021';
commit;
