-- Mateo Perrone / Muises: Monotributo confirmado con su Factura C 00001-00000098 (29/10/2026).
-- Solo cambia la nota de la ficha (la condicion de IVA ya decia Monotributo). Aditivo.
-- Vuelta atras: supabase/rollback/20261029120000_mateo_perrone_monotributo_confirmado.sql
begin;
update public.proveedores
set notas = replace(notas, 'Condición de IVA a confirmar con su factura.', 'Monotributo confirmado con su FC C 00001-00000098 (29/10/2026).'),
    condicion_iva = 'Monotributo'
where cuit = '20452221951' and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021';
commit;
