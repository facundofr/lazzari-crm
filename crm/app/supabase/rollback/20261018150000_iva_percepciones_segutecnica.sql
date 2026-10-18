-- Vuelta atrás de supabase/migrations/20261018150000_iva_percepciones_segutecnica.sql:
-- deja el IVA y las percepciones como estaban (percepción sumada al IVA).

update public.facturas_compra
   set iva = 122591.25, percepciones = 0
 where id = '05c4ba68-3fac-41d2-a550-5bc3cbd1a8bb' and iva = 102976.65 and percepciones = 19614.60;

update public.facturas_compra
   set iva = 253550.00, percepciones = 0
 where id = 'a890c68a-bc7d-46e7-8385-eacef7d13a96' and iva = 212982.00 and percepciones = 40568.00;
