-- Prueba de 20261013230000_factura_servicio_categoria.sql (todo se deshace).
select 'facturas_compra.categoria_gasto' as columna, count(*)::text as existe from information_schema.columns where table_name='facturas_compra' and column_name='categoria_gasto'
union all
select 'gastos_fijos.proveedor_id', count(*)::text from information_schema.columns where table_name='gastos_fijos' and column_name='proveedor_id'
union all
select 'facturas sin tocar', count(*)::text from facturas_compra where categoria_gasto is null;
