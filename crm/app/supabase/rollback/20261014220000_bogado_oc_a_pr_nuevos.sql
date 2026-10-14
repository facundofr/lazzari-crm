-- Vuelta atrás de 20261014220000_bogado_oc_a_pr_nuevos.sql: las 3 OC vuelven a sus PR originales.
begin;
update public.ordenes_compra set presupuesto_origen_id = (select id from public.presupuestos where numero = 'PR-2026-1215') where numero in ('OC-2026-1221', 'OC-2026-1239');
update public.ordenes_compra set presupuesto_origen_id = (select id from public.presupuestos where numero = 'PR-2026-1252') where numero = 'OC-2026-1240';
commit;
