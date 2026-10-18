-- 18/10/2026 (chat Compras, OK de Augusto): las 2 facturas de Segutécnica cargadas con «Compras Lazza»
-- quedaron con la percepción de IIBB (4 %) sumada al IVA, porque el QR de ARCA solo trae el total
-- y la pantalla calculaba IVA = total − neto. El total NO cambia (Pagos queda igual); solo se separa
-- IVA (21 % del neto) y percepciones.
--   FC 00014-00073759: IVA 122.591,25 → 102.976,65 · percepciones 0 → 19.614,60 (total 612.956,25)
--   FC 00014-00073760: IVA 253.550,00 → 212.982,00 · percepciones 0 → 40.568,00 (total 1.267.750,00)
-- Solo cambia si los valores siguen como quedaron (si alguien ya los corrigió, no toca nada).
-- Vuelta atrás: supabase/rollback/20261018150000_iva_percepciones_segutecnica.sql

update public.facturas_compra
   set iva = 102976.65, percepciones = 19614.60
 where id = '05c4ba68-3fac-41d2-a550-5bc3cbd1a8bb'
   and numero_factura = '00014-00073759' and iva = 122591.25 and percepciones = 0 and total = 612956.25;

update public.facturas_compra
   set iva = 212982.00, percepciones = 40568.00
 where id = 'a890c68a-bc7d-46e7-8385-eacef7d13a96'
   and numero_factura = '00014-00073760' and iva = 253550.00 and percepciones = 0 and total = 1267750.00;

-- Control: tiene que mostrar las 2 facturas con el IVA y las percepciones nuevas.
select numero_factura, subtotal, iva, percepciones, total, subtotal + iva + percepciones as suma
  from public.facturas_compra
 where id in ('05c4ba68-3fac-41d2-a550-5bc3cbd1a8bb', 'a890c68a-bc7d-46e7-8385-eacef7d13a96');
