-- Vuelta atras de 20261014190000: deja el PR-2026-1120 en $248.526,61 neto (la nota interna queda como historial).
begin;
update public.presupuesto_items
set precio_venta = 248526.61, subtotal = 248526.61, iva = 52190.59, total = 300717.20, markup_porcentaje = 40
where id = '2e54df23-11df-4db5-be77-3f8019b45e6e' and subtotal = 293998.84;
update public.presupuestos
set subtotal = 248526.61, iva = 52190.59, total = 300717.20
where id = '57ae9391-5f96-4f98-8a8d-1fd0a4463747' and subtotal = 293998.84;
commit;
