-- Seguridad, Tanda 1 Parte D (auditoría integral 28/10/2026; Augusto: "seguimos con la parte D y la tanda 2").
-- ⚠️ CORRER SOLO DESPUÉS DE PUBLICAR la versión que trae /api/archivo (si no, los links nuevos no abren).
--   1. Los links guardados de archivos pasan del link público de Supabase al link propio del CRM (/api/archivo/...),
--      que pide estar logueado y abre el archivo con un link firmado que vence en un minuto.
--      Al 28/10: 133 facturas de compra, 68 OP con adjuntos, 58 presupuestos, 10 certificados y 4 fotos de remitos.
--   2. Los buckets facturas-compra, comprobantes, certificados y presupuestos pasan a PRIVADOS: el link público viejo
--      ya no abre. productos (fotos del catálogo) sigue público.
-- No borra archivos ni filas: solo cambia el comienzo del texto de los links y la marca "público" de los buckets.
-- Los mails ya mandados no se ven afectados: los archivos van adjuntos, no como link.
-- Vuelta atrás: supabase/rollback/20261028150000_archivos_privados.sql
-- Prueba: scripts/db/pruebas/archivos_privados.sql
begin;

-- 1. Links guardados (texto)
update public.facturas_compra set archivo_url = replace(archivo_url, 'https://ycuzszzskqatlegtbgbq.supabase.co/storage/v1/object/public/', '/api/archivo/')
  where archivo_url like 'https://ycuzszzskqatlegtbgbq.supabase.co/storage/v1/object/public/%';
update public.presupuestos set archivo_url = replace(archivo_url, 'https://ycuzszzskqatlegtbgbq.supabase.co/storage/v1/object/public/', '/api/archivo/')
  where archivo_url like 'https://ycuzszzskqatlegtbgbq.supabase.co/storage/v1/object/public/%';
update public.certificados_retencion set archivo_url = replace(archivo_url, 'https://ycuzszzskqatlegtbgbq.supabase.co/storage/v1/object/public/', '/api/archivo/')
  where archivo_url like 'https://ycuzszzskqatlegtbgbq.supabase.co/storage/v1/object/public/%';
update public.remitos set foto_url = replace(foto_url, 'https://ycuzszzskqatlegtbgbq.supabase.co/storage/v1/object/public/', '/api/archivo/')
  where foto_url like 'https://ycuzszzskqatlegtbgbq.supabase.co/storage/v1/object/public/%';
update public.oc_remitos set foto_url = replace(foto_url, 'https://ycuzszzskqatlegtbgbq.supabase.co/storage/v1/object/public/', '/api/archivo/')
  where foto_url like 'https://ycuzszzskqatlegtbgbq.supabase.co/storage/v1/object/public/%';
update public.ordenes_pago set certificado_retencion_url = replace(certificado_retencion_url, 'https://ycuzszzskqatlegtbgbq.supabase.co/storage/v1/object/public/', '/api/archivo/')
  where certificado_retencion_url like 'https://ycuzszzskqatlegtbgbq.supabase.co/storage/v1/object/public/%';
update public.ordenes_pago set comprobante_url = replace(comprobante_url, 'https://ycuzszzskqatlegtbgbq.supabase.co/storage/v1/object/public/', '/api/archivo/')
  where comprobante_url like 'https://ycuzszzskqatlegtbgbq.supabase.co/storage/v1/object/public/%';
update public.gastos_manuales set comprobante_url = replace(comprobante_url, 'https://ycuzszzskqatlegtbgbq.supabase.co/storage/v1/object/public/', '/api/archivo/')
  where comprobante_url like 'https://ycuzszzskqatlegtbgbq.supabase.co/storage/v1/object/public/%';
update public.pagos_lote_items set comprobante_url = replace(comprobante_url, 'https://ycuzszzskqatlegtbgbq.supabase.co/storage/v1/object/public/', '/api/archivo/')
  where comprobante_url like 'https://ycuzszzskqatlegtbgbq.supabase.co/storage/v1/object/public/%';
update public.personalizacion_logos set archivo_url = replace(archivo_url, 'https://ycuzszzskqatlegtbgbq.supabase.co/storage/v1/object/public/', '/api/archivo/')
  where archivo_url like 'https://ycuzszzskqatlegtbgbq.supabase.co/storage/v1/object/public/%';
update public.tarjeta_resumenes set archivo_url = replace(archivo_url, 'https://ycuzszzskqatlegtbgbq.supabase.co/storage/v1/object/public/', '/api/archivo/')
  where archivo_url like 'https://ycuzszzskqatlegtbgbq.supabase.co/storage/v1/object/public/%';
-- Adjuntos de OP (jsonb): el link aparece dentro del texto
update public.ordenes_pago set archivos = replace(archivos::text, 'https://ycuzszzskqatlegtbgbq.supabase.co/storage/v1/object/public/', '/api/archivo/')::jsonb
  where archivos::text like '%https://ycuzszzskqatlegtbgbq.supabase.co/storage/v1/object/public/%';

-- 2. Buckets privados
update storage.buckets set public = false where id in ('facturas-compra', 'comprobantes', 'certificados', 'presupuestos');

commit;
