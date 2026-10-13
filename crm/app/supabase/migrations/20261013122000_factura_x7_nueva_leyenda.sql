-- Factura X 0000-00000007 (Coop. La Nueva Leyenda, PR-2026-1189) salió sin el IVA del precio final del PR manual
-- (error de Ventas ya corregido en V1.1.426). Se corrige a lo aprobado: 6 x $41.940 = $251.640 — 13/10/2026, con OK de Augusto.
-- Comprobante manual sin CAE: no pasa por ARCA. Sin cobros cargados. Copia previa: Claude outputs/antes_factura_x7_nueva_leyenda_13_10_2026.txt
-- Vuelta atrás: supabase/rollback/20261013122000_factura_x7_nueva_leyenda.sql
begin;

update public.factura_items set precio_unitario = 41940
where factura_id = 'e35eaedb-a24b-4cda-b9d5-fa4b58483b87' and precio_unitario = 34661.16;

update public.facturas set subtotal = 251640, total = 251640
where id = 'e35eaedb-a24b-4cda-b9d5-fa4b58483b87' and tipo = 'X' and cae is null and total = 207966.96;

commit;
