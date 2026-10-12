-- Vuelta atrás de 20261012220000_proveedores_admin_comercial.sql (deja todo como estaba el 12/10/2026).
begin;

update proveedores set email = null, notas = '' where id in ('25b3ffb7-92af-4793-90ed-9ab6c9826c04', '59d9eb14-42af-48bb-8cd4-fe97074a1e68');
insert into contactos (id, entity_type, entity_id, nombre, cargo, email, telefono, whatsapp, principal, notas, created_at) values
  ('12781bf7-fbe8-4b52-8f26-8a70ae0d17f9', 'proveedor', '25b3ffb7-92af-4793-90ed-9ab6c9826c04', 'Belen', 'Cobros', 'cuentascorrientes@startex.com.ar', null, null, false, null, '2026-09-24T14:50:41.836Z'),
  ('c40e6397-2032-4265-a258-f80a3e503c0e', 'proveedor', '59d9eb14-42af-48bb-8cd4-fe97074a1e68', 'Info', 'Cobros', 'info@felemax.com', null, null, false, null, '2026-09-24T15:00:42.951Z')
on conflict (id) do nothing;
update contactos set cargo = null where id in ('c1e1b6ec-84c3-407d-96e0-c134b95f2759', '4ab4f44b-7cc8-4c3e-95ca-e57cdfe47b34');

update proveedores set telefono = '2477672724' where id = '6a4ef42f-490e-4a47-93b6-125dcf21f514';
update proveedores set telefono = '1160147047' where id = '74b35a54-a94a-4fc2-b2fc-146c6c8c7ac6';
update proveedores set telefono = '+54 9 3412 27-8686' where id = '894a18e3-404c-4857-ae71-7032440f0d57';
update proveedores set telefono = '1144009366' where id = '6e2b1ffe-88bb-4eda-9c39-46065dd81475';
update proveedores set telefono = '1122672194' where id = '44f56fdc-c0ab-460d-b460-17b0d4c1bbcf';
update proveedores set telefono = '54 9 11 2392-4985' where id = '07950ef3-0e57-416a-8d07-764dd56d3259';
update proveedores set telefono = '2477610902' where id = '40f36974-c031-4692-9312-71a21db88ee4';
update proveedores set telefono = '54 9 2236 80-8666' where id = 'b9f9b907-38ff-41f9-85fa-08147407f435';
update proveedores set telefono = '2477 45-3763' where id = '5bb57738-fe72-4696-8741-f9b263b4e9ec';
update proveedores set telefono = '2364 266805' where id = '6b06d5bd-5786-4d30-9fa8-d1a6847269ff';
update proveedores set telefono = '011 77385545' where id = 'fe425ac6-7e0f-4369-ba9d-751ef71600cf';
update proveedores set telefono = '+54 9 2477 35-4035' where id = 'a13ccbf0-e7e2-4bd0-b5d6-31ab0b27ed94';
update proveedores set telefono = '1140434325' where id = '47dfb3dd-35a6-4fe8-987d-44e39c4bd7f6';
update proveedores set telefono = '54 9 11 3596-8714' where id = '2d79086a-239d-43b6-bbfd-5432cab4474e';
update contactos set whatsapp = '1136591668', telefono = null where id = '4ab4f44b-7cc8-4c3e-95ca-e57cdfe47b34';

commit;
