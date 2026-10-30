-- 29/10/2026 (Augusto: "marca milonguitas como transporte"): Cooperativa de Trabajo Milonguitas pasa a transportista en las dos sociedades.
-- Así aparece en el catálogo de Transportes y Compras Lazza sugiere «Transporte (flete)» al cargar sus facturas.
-- Su concepto de retención de Ganancias ya era 'transporte' (no cambia). Antes: es_transportista = false en las dos.
-- Vuelta atrás: supabase/rollback/20261029200000_milonguitas_transportista.sql
begin;
update public.proveedores set es_transportista = true
where es_transportista = false and id in ('6730ae6f-3a03-4f91-a7f0-5649ff7539e5', '8e7bf500-7f5f-41bb-a990-e46bef717213');
commit;
