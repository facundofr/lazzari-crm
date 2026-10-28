-- Prueba de 20261028150000_archivos_privados.sql (SOLO LECTURA). Las 3 filas tienen que dar ok = true.
select 'los 4 buckets de documentos son privados' as que,
  (select count(*) from storage.buckets where id in ('facturas-compra', 'comprobantes', 'certificados', 'presupuestos') and not public) = 4 as ok
union all
select 'productos (catálogo) sigue público',
  (select public from storage.buckets where id = 'productos')
union all
select 'no queda ningún link público viejo guardado',
  not exists (select 1 from public.facturas_compra where archivo_url like '%/object/public/%')
  and not exists (select 1 from public.presupuestos where archivo_url like '%/object/public/%')
  and not exists (select 1 from public.certificados_retencion where archivo_url like '%/object/public/%')
  and not exists (select 1 from public.remitos where foto_url like '%/object/public/%')
  and not exists (select 1 from public.oc_remitos where foto_url like '%/object/public/%')
  and not exists (select 1 from public.ordenes_pago where archivos::text like '%/object/public/%'
    or certificado_retencion_url like '%/object/public/%' or comprobante_url like '%/object/public/%');
