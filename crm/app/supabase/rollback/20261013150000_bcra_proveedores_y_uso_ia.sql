-- Vuelta atrás de 20261013150000_bcra_proveedores_y_uso_ia.sql
-- ⚠️ Borra las dos tablas nuevas y lo que tengan cargado (informes BCRA de proveedores y contador de IA).
-- No toca ninguna otra tabla.
begin;
drop table if exists public.proveedor_bcra_informes;
drop table if exists public.ia_uso;
commit;
