-- Prueba de 20261029180000_borrar_tablas_personalizacion.sql (corre dentro de la misma transacción y se deshace siempre).
select count(*) as tablas_personalizacion_que_quedan from information_schema.tables where table_schema = 'public' and table_name like 'personalizacion%';
select count(*) as proveedores_ok, count(*) filter (where es_personalizador) as talleres from public.proveedores;
