-- Vuelta atrás de 20261029150000_borrar_nuevo_plus_ultra.sql: vuelve a crear la ficha y el transportista, inactivos.
begin;
insert into public.proveedores (id, sociedad_id, razon_social, cuit, activo, notas)
select 'db1a182b-6bff-423f-8956-c4259ad9c1d4', 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021', 'Nuevo Plus Ultra S.A.', '30710320531', false,
  'NO USAR. Ex firma de Rapido Plus Ultra.'
where not exists (select 1 from public.proveedores where id = 'db1a182b-6bff-423f-8956-c4259ad9c1d4');
insert into public.transportistas (id, sociedad_id, nombre, razon_social, cuit, activo)
select '59545905-00fb-41ae-b407-3fb42808fd85', 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021', 'Nuevo Plus Ultra S.A.', 'Nuevo Plus Ultra S.A.', '30710320531', false
where not exists (select 1 from public.transportistas where id = '59545905-00fb-41ae-b407-3fb42808fd85');
commit;
