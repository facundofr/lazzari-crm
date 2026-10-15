-- Vuelta atrás de 20261016090000: saca solo los gastos que cargó ese archivo (marcados en notas).
begin;
delete from public.gastos_manuales
where notas like '%Carga gastos-fijos-octubre-2026%'
  and not exists (select 1 from public.movimientos mv where mv.gasto_manual_id = gastos_manuales.id);
commit;
