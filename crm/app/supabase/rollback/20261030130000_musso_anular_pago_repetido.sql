-- Vuelta atrás de 20261030130000: el pago de $ 178.200 del gasto de Musso deja de estar anulado y el gasto vuelve a su nota anterior (vacía).
begin;
update public.movimientos
   set anulado = false, monto = 178200, monto_original = null, anulado_at = null, anulado_por = null, conciliado = false,
       descripcion = 'Gasto — Profesionales — Honorarios contador (Agustín Musso) — octubre 2026'
 where id = '7c4e7830-49c9-448c-806f-3b0e430ab25d';
update public.gastos_manuales set notas = '' where id = '6e40fe0a-b1de-4939-bafc-eda778e9feb6';
commit;
