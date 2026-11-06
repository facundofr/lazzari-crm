-- Vuelta atrás de 20261106120000_facturas_compra_tipo_cambio.sql
-- ⚠️ Antes de correrla, volver el código a la versión anterior (la nueva lee y guarda facturas_compra.tipo_cambio).
-- Devuelve las 2 NC de Segutecnica como estaban y saca la columna (se pierden los tipos de cambio cargados; el IVA vuelve a
-- usar el dólar BNA del día).
begin;
update public.facturas_compra set iva = 1270.50, percepciones = 0,
  notas = replace(notas, E'\n[06/11/2026] IVA y percepción separados como en ARCA (antes la percepción estaba sumada al IVA). El total no cambia.', '')
where id = 'ea9eef82-7dc9-4a01-9121-f7e6ef06e288' and iva = 1067.22;
update public.facturas_compra set iva = 1420.00, percepciones = 0,
  notas = replace(notas, E'\n[06/11/2026] IVA y percepción separados como en ARCA (antes la percepción estaba sumada al IVA). El total no cambia.', '')
where id = 'ee6ad1fe-6068-475c-939d-81082a2fd788' and iva = 1192.80;
alter table public.facturas_compra drop column if exists tipo_cambio;
commit;
