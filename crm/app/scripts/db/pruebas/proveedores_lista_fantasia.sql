-- Prueba de 20261012200000_proveedores_lista_fantasia.sql (se corre con --probar: al final se deshace todo).
select s.nombre as soc, cp.proveedor_lista, p.razon_social, p.nombre_fantasia
from catalogo_proveedores cp join proveedores p on p.id = cp.proveedor_id join sociedades s on s.id = cp.sociedad_id
order by 2, 1;
select razon_social, nombre_fantasia from proveedores where regexp_replace(coalesce(cuit,''), '\D', '', 'g') = '30712325468';
