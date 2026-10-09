-- SOLO LECTURA: no cambia nada. Revisa si la base tiene todo lo que necesitan las notas de crédito.
select 'Función NC venta (registrar_nota_credito_venta_autorizada)' as control,
       case when exists (select 1 from pg_proc where proname = 'registrar_nota_credito_venta_autorizada') then 'OK' else 'FALTA' end as estado
union all
select 'Columnas NC en facturas (factura_origen_id, total_acreditado, saldo_a_favor_cliente)',
       case when (select count(*) from information_schema.columns where table_schema='public' and table_name='facturas'
                  and column_name in ('factura_origen_id','total_acreditado','nota_credito_request_key','nota_credito_modo','credito_aplicado','saldo_a_favor_cliente')) = 6 then 'OK' else 'FALTA' end
union all
select 'Función NC compra (registrar_nota_credito_compra)',
       case when exists (select 1 from pg_proc where proname = 'registrar_nota_credito_compra') then 'OK' else 'FALTA' end
union all
select 'Anular OP segura (anular_orden_pago_segura)',
       case when exists (select 1 from pg_proc where proname = 'anular_orden_pago_segura') then 'OK' else 'FALTA' end
union all
select 'Bloqueo factura duplicada en OP',
       case when exists (select 1 from pg_proc where proname = 'bloquear_mismo_registro_factura_en_op') then 'OK' else 'FALTA' end
union all
select 'Transportistas como proveedores (proveedores.es_transportista)',
       case when exists (select 1 from information_schema.columns where table_schema='public' and table_name='proveedores' and column_name='es_transportista') then 'OK' else 'FALTA' end
union all
select 'Emisiones fiscales (fiscal_emission_attempts)',
       case when exists (select 1 from information_schema.tables where table_schema='public' and table_name like 'fiscal_emission%') then 'OK' else 'FALTA' end
union all
select 'NC de venta ya emitidas (cantidad)',
       (select count(*)::text from public.facturas where tipo in ('NCA','NCB','NCEA','NCEB'));
