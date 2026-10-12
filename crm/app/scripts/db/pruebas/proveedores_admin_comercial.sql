-- Prueba de 20261012220000_proveedores_admin_comercial.sql (se corre con --probar: al final se deshace todo).
select razon_social, email, notas from proveedores where id in ('25b3ffb7-92af-4793-90ed-9ab6c9826c04', '59d9eb14-42af-48bb-8cd4-fe97074a1e68');
select p.razon_social, c.nombre, c.cargo, c.email, c.whatsapp, c.telefono from contactos c join proveedores p on p.id = c.entity_id where c.entity_type = 'proveedor';
select razon_social, telefono from proveedores where coalesce(trim(telefono), '') <> '' order by 1;
