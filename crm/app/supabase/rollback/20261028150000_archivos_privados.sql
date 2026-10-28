-- Vuelta atrás de 20261028150000_archivos_privados.sql: los 4 buckets vuelven a públicos y los links guardados vuelven
-- al link público de Supabase. Ojo: también vuelve al link público lo subido DESPUÉS de la migración (sigue abriendo igual,
-- porque el bucket vuelve a ser público). No borra nada.
begin;

update storage.buckets set public = true where id in ('facturas-compra', 'comprobantes', 'certificados', 'presupuestos');

update public.facturas_compra set archivo_url = replace(archivo_url, '/api/archivo/', 'https://ycuzszzskqatlegtbgbq.supabase.co/storage/v1/object/public/')
  where archivo_url like '/api/archivo/%';
update public.presupuestos set archivo_url = replace(archivo_url, '/api/archivo/', 'https://ycuzszzskqatlegtbgbq.supabase.co/storage/v1/object/public/')
  where archivo_url like '/api/archivo/%';
update public.certificados_retencion set archivo_url = replace(archivo_url, '/api/archivo/', 'https://ycuzszzskqatlegtbgbq.supabase.co/storage/v1/object/public/')
  where archivo_url like '/api/archivo/%';
update public.remitos set foto_url = replace(foto_url, '/api/archivo/', 'https://ycuzszzskqatlegtbgbq.supabase.co/storage/v1/object/public/')
  where foto_url like '/api/archivo/%';
update public.oc_remitos set foto_url = replace(foto_url, '/api/archivo/', 'https://ycuzszzskqatlegtbgbq.supabase.co/storage/v1/object/public/')
  where foto_url like '/api/archivo/%';
update public.ordenes_pago set certificado_retencion_url = replace(certificado_retencion_url, '/api/archivo/', 'https://ycuzszzskqatlegtbgbq.supabase.co/storage/v1/object/public/')
  where certificado_retencion_url like '/api/archivo/%';
update public.ordenes_pago set comprobante_url = replace(comprobante_url, '/api/archivo/', 'https://ycuzszzskqatlegtbgbq.supabase.co/storage/v1/object/public/')
  where comprobante_url like '/api/archivo/%';
update public.gastos_manuales set comprobante_url = replace(comprobante_url, '/api/archivo/', 'https://ycuzszzskqatlegtbgbq.supabase.co/storage/v1/object/public/')
  where comprobante_url like '/api/archivo/%';
update public.pagos_lote_items set comprobante_url = replace(comprobante_url, '/api/archivo/', 'https://ycuzszzskqatlegtbgbq.supabase.co/storage/v1/object/public/')
  where comprobante_url like '/api/archivo/%';
update public.personalizacion_logos set archivo_url = replace(archivo_url, '/api/archivo/', 'https://ycuzszzskqatlegtbgbq.supabase.co/storage/v1/object/public/')
  where archivo_url like '/api/archivo/%';
update public.tarjeta_resumenes set archivo_url = replace(archivo_url, '/api/archivo/', 'https://ycuzszzskqatlegtbgbq.supabase.co/storage/v1/object/public/')
  where archivo_url like '/api/archivo/%';
update public.ordenes_pago set archivos = replace(archivos::text, '/api/archivo/', 'https://ycuzszzskqatlegtbgbq.supabase.co/storage/v1/object/public/')::jsonb
  where archivos::text like '%/api/archivo/%';

commit;
