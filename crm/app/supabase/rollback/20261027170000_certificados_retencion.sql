-- Vuelta atrás de 20261027170000_certificados_retencion.sql: saca la tabla de certificados de retenciones sufridas.
-- Se pierden los N° cargados con «Cargar certificado» (con IA o a mano) y sus enlaces a los PDF (los archivos quedan en
-- Storage). Los movimientos quedan como están: vuelve a valer solo el N° escrito en su texto.
begin;
drop table if exists public.certificados_retencion;
drop function if exists public.certificados_retencion_validar();
commit;
