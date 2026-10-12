-- Vuelta atrás de 20261012200000_proveedores_lista_fantasia.sql
-- Deja los vínculos y nombres de fantasía como estaban antes (12/10/2026): solo BH Industrial, Delta Plus (Espacio Marketing) y FADI,
-- y nombre de fantasía solo en FADI y Espacio Marketing ("Delta Plus").
begin;

delete from catalogo_proveedores
where proveedor_lista in ('Prisina','TKW','Startex','Aire Libre','Mediglove','Segutécnica','Segufer','Iturria','SPI','DPS','Conoflex')
   or (proveedor_lista in ('FADI','BH Industrial') and sociedad_id <> 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021');

insert into catalogo_proveedores (id, sociedad_id, proveedor_lista, proveedor_id, created_at)
values ('2b311cc7-9cdc-4f2b-b14c-377a858f824f', 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021', 'Delta Plus', '071d6168-6ec0-4d37-bbde-0a353902a8a6', '2026-10-09T14:19:12.481Z')
on conflict (sociedad_id, proveedor_lista) do update set proveedor_id = excluded.proveedor_id;

update proveedores set nombre_fantasia = 'Delta Plus' where id = '071d6168-6ec0-4d37-bbde-0a353902a8a6';

update proveedores set nombre_fantasia = null
where nombre_fantasia in ('Prisina','TKW','Startex','Aire Libre','Mediglove','Segutécnica','Segufer','BH Industrial','Iturria','SPI','DPS','Conoflex')
   or (nombre_fantasia = 'FADI' and sociedad_id <> 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021');

commit;
