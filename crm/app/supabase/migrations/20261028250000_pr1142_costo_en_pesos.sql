-- 28/10/2026 (Augusto confirmó): PR-2026-1142 (Municipalidad de Pergamino, FB 0015-00000005): el costo del protector auditivo (36.425) está en PESOS
-- (equivale a ~US$ 24, como en la lista de Segutécnica) pero quedó con la moneda USD: Reportes de septiembre le asignaba $ 54,9 M de costo a una venta de $ 49 mil.
-- Aditivo: cambia solo la moneda del costo de 1 renglón. Vuelta atrás: supabase/rollback/20261028250000_pr1142_costo_en_pesos.sql
begin;

update public.presupuesto_items set costo_moneda = 'ARS'
where id = '5e81bbd6-9fce-49ca-a259-709602f4618d' and costo_moneda = 'USD' and precio_costo = 36425;

commit;
