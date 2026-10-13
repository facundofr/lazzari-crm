-- Vuelta atrás de 20261013190000_op_usd_en_pesos.sql:
-- saca la función nueva. Las 3 columnas de ordenes_pago se dejan (si hay OP en pesos de facturas USD,
-- guardan su cotización); para sacarlas también, descomentar las últimas líneas.

drop function if exists public.registrar_op_usd_en_pesos(uuid, uuid, uuid, date, numeric, date, jsonb, jsonb, jsonb, numeric, numeric, numeric, numeric, text, boolean);

-- alter table public.ordenes_pago drop column if exists cotizacion;
-- alter table public.ordenes_pago drop column if exists cotizacion_fecha;
-- alter table public.ordenes_pago drop column if exists moneda_documentos;
