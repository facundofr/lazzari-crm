-- 29/10/2026 (Augusto, pedido del chat Finanzas): 4 facturas de flete de Lazzari quedaron como "mercadería" y no contaban en Transportes
-- (Gastos, Reportes y Contabilidad solo cuentan facturas_compra con tipo = 'transporte'). Pasan a "transporte".
-- Antes las 4 eran 'mercaderia' (la vuelta atrás las deja así). El tipo no cambia Pagar, OP ni la cuenta corriente del proveedor;
-- ningún trigger mira la columna tipo. Pluscargo 0002-00064652 (flete aéreo en US$) NO se toca.
-- Vuelta atrás: supabase/rollback/20261029190000_fletes_a_transporte.sql · Prueba: scripts/db/pruebas/fletes_a_transporte.sql
begin;

update public.facturas_compra set tipo = 'transporte'
where sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and tipo = 'mercaderia' and id in (
  '8a6250af-cc80-41c8-bed6-af2bd81149b8', -- Sinpostre 0016-00010179 (25/09, neto 157.500, FLETES GENERALES)
  '263968c1-e7ec-48a1-9a43-89497582ab40', -- Milonguitas 00006-00035023 (15/10, neto 52.892,56)
  '2b1e388a-f960-4d83-b44d-684a9c5b4827', -- Comisiones Serger 0004-00026653 (21/10, neto 50.000, traslado interno)
  'dc88f81b-4af3-4bb6-a8e5-4d6b94d543b1'  -- Transporte de Cargas Mayo 00003-00001324 (26/10, neto 135.000)
);

commit;
