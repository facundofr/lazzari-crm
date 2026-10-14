-- Corrige el precio del PR-2026-1120 (Corteva, cafetera) a lo cotizado: $293.998,84 neto — 14/10/2026, OK de Augusto.
-- Se hace en la base y no desde la pantalla porque editar el PR rehace la OC al proveedor (borra la recepcion y el vinculo con la factura).
-- Solo cambia 1 renglon y la cabecera del PR; no toca OC, remitos ni facturas. Se aplica solo si el PR sigue con $248.526,61.
-- Vuelta atras: supabase/rollback/20261014190000_corregir_precio_pr_1120.sql
begin;

update public.presupuesto_items
set precio_venta = 293998.84, subtotal = 293998.84, iva = 61739.76, total = 355738.60, markup_porcentaje = 89.73
where id = '2e54df23-11df-4db5-be77-3f8019b45e6e' and presupuesto_id = '57ae9391-5f96-4f98-8a8d-1fd0a4463747'
  and subtotal = 248526.61;

update public.presupuestos
set subtotal = 293998.84, iva = 61739.76, total = 355738.60,
    notas_internas = coalesce(notas_internas || E'\n', '') || '[14/10/2026] Precio corregido de $248.526,61 a $293.998,84 neto (total 355.738,60) por reclamo del cliente; NC 0015-00000007 de la FA 0015-00000037, factura nueva a emitir con fecha 13/10.'
where id = '57ae9391-5f96-4f98-8a8d-1fd0a4463747' and subtotal = 248526.61;

commit;
