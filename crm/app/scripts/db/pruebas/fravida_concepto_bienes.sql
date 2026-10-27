-- Prueba de 20261027152000_fravida_concepto_bienes.sql (se corre con --probar: muestra resultados y DESHACE todo).
select razon_social || ' · ' || (select nombre from public.sociedades s where s.id = p.sociedad_id) as control,
       coalesce(concepto_retencion_ganancias, '(sin concepto)') || ' · ' || coalesce(alicuota_ganancias::text, '—') as valor,
       case when sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' then 'esperado compraventa_bienes · 2' else 'Grupo LA: esperado sin cambios' end as nota
  from public.proveedores p where cuit = '30500600183'
union all select 'OP y facturas de compra de Fravida', (select count(*) from public.ordenes_pago where proveedor_id = 'ca47e974-5e7c-4b5a-8eec-bba0dc9ecf03')::text || ' · '
       || (select count(*) from public.facturas_compra where proveedor_id = 'ca47e974-5e7c-4b5a-8eec-bba0dc9ecf03')::text, 'esperado 0 · 0';
