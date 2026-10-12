-- Proveedores: un mail de ADMINISTRACIÓN (facturas, cobros y pagos) y contactos COMERCIALES (vendedores) — 12/10/2026, pedido de Augusto.
-- 1) Star-Tex y Matcom tenían el mail de administración cargado como contacto "Cobros" y el campo del proveedor vacío:
--    se pasa al campo del proveedor (Star-Tex: nota "Administración: Belén") y se sacan esos 2 contactos (copia en la vuelta atrás).
-- 2) Los contactos de proveedor sin cargo (Air Products, Amoblamientos Nexo) pasan a "Ventas".
-- 3) WhatsApp con un solo formato "característica número" (ej. "2477 688498"), sin +54, 9, 0 ni 15 (15 números).
-- Vuelta atrás: supabase/rollback/20261012220000_proveedores_admin_comercial.sql
begin;

update proveedores set email = 'cuentascorrientes@startex.com.ar',
  notas = trim(coalesce(notas, '') || ' Administración: Belén.'), updated_at = now()
where id = '25b3ffb7-92af-4793-90ed-9ab6c9826c04' and coalesce(trim(email), '') = '';
update proveedores set email = 'info@felemax.com', updated_at = now()
where id = '59d9eb14-42af-48bb-8cd4-fe97074a1e68' and coalesce(trim(email), '') = '';
delete from contactos where id in ('12781bf7-fbe8-4b52-8f26-8a70ae0d17f9', 'c40e6397-2032-4265-a258-f80a3e503c0e') and cargo = 'Cobros';

update contactos set cargo = 'Ventas' where id in ('c1e1b6ec-84c3-407d-96e0-c134b95f2759', '4ab4f44b-7cc8-4c3e-95ca-e57cdfe47b34') and cargo is null;

update proveedores set telefono = '2477 672724' where id = '6a4ef42f-490e-4a47-93b6-125dcf21f514';
update proveedores set telefono = '11 60147047' where id = '74b35a54-a94a-4fc2-b2fc-146c6c8c7ac6';
update proveedores set telefono = '341 2278686' where id = '894a18e3-404c-4857-ae71-7032440f0d57';
update proveedores set telefono = '11 44009366' where id = '6e2b1ffe-88bb-4eda-9c39-46065dd81475';
update proveedores set telefono = '11 22672194' where id = '44f56fdc-c0ab-460d-b460-17b0d4c1bbcf';
update proveedores set telefono = '11 23924985' where id = '07950ef3-0e57-416a-8d07-764dd56d3259';
update proveedores set telefono = '2477 610902' where id = '40f36974-c031-4692-9312-71a21db88ee4';
update proveedores set telefono = '223 6808666' where id = 'b9f9b907-38ff-41f9-85fa-08147407f435';
update proveedores set telefono = '2477 453763' where id = '5bb57738-fe72-4696-8741-f9b263b4e9ec';
update proveedores set telefono = '236 4266805' where id = '6b06d5bd-5786-4d30-9fa8-d1a6847269ff';
update proveedores set telefono = '11 77385545' where id = 'fe425ac6-7e0f-4369-ba9d-751ef71600cf';
update proveedores set telefono = '2477 354035' where id = 'a13ccbf0-e7e2-4bd0-b5d6-31ab0b27ed94';
update proveedores set telefono = '11 40434325' where id = '47dfb3dd-35a6-4fe8-987d-44e39c4bd7f6';
update proveedores set telefono = '11 35968714' where id = '2d79086a-239d-43b6-bbfd-5432cab4474e';
update contactos set whatsapp = '11 36591668', telefono = null where id = '4ab4f44b-7cc8-4c3e-95ca-e57cdfe47b34';

commit;
