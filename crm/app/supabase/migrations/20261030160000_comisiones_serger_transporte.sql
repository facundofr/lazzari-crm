-- Comisiones Serger SRL: se tilda "Transporte" (Augusto 30/10/2026). Sus facturas se cargan desde Transportes.
-- El trigger sync_transportista_desde_proveedor lo suma solo al Catálogo de transportistas. Aditivo.
-- Vuelta atrás: supabase/rollback/20261030160000_comisiones_serger_transporte.sql
begin;
update public.proveedores set es_transportista = true
where id = '70274f7c-458f-4f09-90eb-2792e1babbea' and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021';
commit;
