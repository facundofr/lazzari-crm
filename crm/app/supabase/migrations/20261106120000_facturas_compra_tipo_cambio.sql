-- Tipo de cambio de la factura de compra (Augusto 06/11/2026: "hay que corregir algo para que el crm tome el mismo tipo de
-- cambio que afip para el iva"; plan aprobado: "Sí, hacelo").
-- Las facturas de compra en US$ no guardaban su tipo de cambio: Finanzas › IVA las pasaba a pesos con el dólar BNA del día y no
-- daba igual que AFIP (que usa el TC impreso en la factura / su QR). Desde ahora Compras Lazza guarda el TC que lee del QR o la IA
-- (editable) y el IVA lo usa; sin TC sigue con el dólar del día.
-- 1) Columna nueva facturas_compra.tipo_cambio (vacía).
-- 2) TC de las 13 facturas de compra en US$ con IVA ya cargadas (Lazzari): octubre del CSV de Mis Comprobantes de AFIP
--    (05/11/2026); junio, septiembre y noviembre del PDF de cada factura ("Cotización" / "Tipo de cambio"). Las 2 FC C de
--    Natalia Inga (Grupo LA, sin IVA) quedan sin TC.
-- 3) NC A 00014-00008187 y 00014-00008188 de Segutecnica: la percepción estaba sumada al IVA (AFIP: IVA 1.067,22 + otros
--    tributos 203,28 y IVA 1.192,80 + 227,20). El total no cambia.
-- Solo toca esas filas y solo si siguen como estaban. Vuelta atrás: supabase/rollback/20261106120000_facturas_compra_tipo_cambio.sql
begin;

alter table public.facturas_compra add column if not exists tipo_cambio numeric(14,4);
comment on column public.facturas_compra.tipo_cambio is
  'Tipo de cambio de la factura (US$ → $), el que figura en el comprobante / QR de ARCA (06/11/2026). Null = no se sabe: se usa el dólar BNA del día.';

update public.facturas_compra f set tipo_cambio = v.tc
from (values
  ('c746be8c-3daf-4924-a8db-d453a570081e'::uuid, 1446.5),  -- Spi Shield FC A 00003-00000904 (09/06) · PDF
  ('1d9622a5-3022-40bd-8879-90630aa2cc6d'::uuid, 1511.5),  -- Segufer FC A 00042-00100558 (08/09) · PDF
  ('c62f19a4-7611-4287-bbac-379d57214d0a'::uuid, 1506.5),  -- Segufer FC A 00042-00101199 (16/09) · PDF
  ('c1abef54-6b06-40f0-b812-0bddcf10e59a'::uuid, 1511.5),  -- Segufer NC A 00042-00004630 (30/09) · PDF
  ('4b2fdf42-f2de-46cb-875c-e1bab85a4ffc'::uuid, 1506.5),  -- Segufer NC A 00042-00004674 (07/10) · AFIP
  ('96b15af4-0fc3-40a3-a2eb-6a47ba5be933'::uuid, 1625.0),  -- Pluscargo FC A 0002-00064652 (14/10) · AFIP
  ('5958c0a9-f392-49ca-9449-4a9bc08bd910'::uuid, 1512.5),  -- Segufer FC A 00042-00103132 (14/10) · AFIP
  ('77812e9d-0a23-4740-9fe6-734327c54f5a'::uuid, 1512.5),  -- Segufer FC A 00042-00103105 (14/10) · AFIP
  ('1c0d9d83-5c63-40d3-acc1-a5b2e3747d8e'::uuid, 1513.0),  -- Segufer FC A 00042-00103315 (16/10) · AFIP
  ('a8cc18e3-7ee9-4dd9-a8a9-0723c5614304'::uuid, 1529.5),  -- Segufer FC A 00042-00103951 (26/10) · AFIP
  ('a0b4b267-fc94-47c4-8bb2-1359889f1ba1'::uuid, 1541.0),  -- Segufer FC A 00042-00104018 (27/10) · AFIP
  ('756bf135-8b20-4402-94ca-2dc4a5117d32'::uuid, 1534.0),  -- Segufer FC A 00042-00104441 (02/11) · PDF
  ('a9a6345a-94a0-49a5-9e26-a6624d4de14d'::uuid, 1534.0)   -- Segufer FC A 00042-00104491 (02/11) · PDF
) as v(id, tc)
where f.id = v.id and f.moneda = 'USD' and f.tipo_cambio is null;

update public.facturas_compra f set iva = v.iva, percepciones = v.perc,
  notas = coalesce(f.notas, '') || E'\n[06/11/2026] IVA y percepción separados como en ARCA (antes la percepción estaba sumada al IVA). El total no cambia.'
from (values
  ('ea9eef82-7dc9-4a01-9121-f7e6ef06e288'::uuid, 1067.22, 203.28, 1270.50),  -- Segutecnica NC A 00014-00008187
  ('ee6ad1fe-6068-475c-939d-81082a2fd788'::uuid, 1192.80, 227.20, 1420.00)   -- Segutecnica NC A 00014-00008188
) as v(id, iva, perc, iva_antes)
where f.id = v.id and f.iva = v.iva_antes and coalesce(f.percepciones, 0) = 0;

commit;
