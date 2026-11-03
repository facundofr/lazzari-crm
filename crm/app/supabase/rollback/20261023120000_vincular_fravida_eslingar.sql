-- Vuelta atrás de 20261023120000_vincular_fravida_eslingar.sql
-- Saca los vínculos de Fravida y Delta Plus con la lista de costos y el nombre de fantasía que puso esa migración
-- (solo en los proveedores con esos CUIT). No borra proveedores.
begin;

delete from catalogo_proveedores cp
using proveedores p
where cp.proveedor_id = p.id
  and ((cp.proveedor_lista = 'Fravida' and regexp_replace(coalesce(p.cuit, ''), '\D', '', 'g') = '30500600183')
    or (cp.proveedor_lista = 'Delta Plus' and regexp_replace(coalesce(p.cuit, ''), '\D', '', 'g') = '30701753832'));

update proveedores set nombre_fantasia = null, updated_at = now()
where (regexp_replace(coalesce(cuit, ''), '\D', '', 'g') = '30500600183' and nombre_fantasia = 'Fravida')
   or (regexp_replace(coalesce(cuit, ''), '\D', '', 'g') = '30701753832' and nombre_fantasia = 'Delta Plus');

commit;
