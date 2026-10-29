-- 28/10/2026 (Augusto): el pago de ARCA Autónomos (período 09/2026, categoría 302) es de Augusto: va en Sueldos como "Augusto", igual que el monotributo de los demás.
-- Aditivo: solo cambia categoría, grupo y texto de 1 gasto y de su pago. Vuelta atrás: supabase/rollback/20261028220000_autonomos_augusto_a_sueldos.sql
begin;

update public.gastos_manuales
set categoria = 'Sueldos', grupo = 'Personal', descripcion = 'Autónomos Augusto — ARCA período 09/2026, categoría 302 (transacción 3236)'
where id = '8ddf6090-ebb8-4662-9bb4-4b095bb38e6b' and categoria = 'Impuestos';

update public.movimientos
set descripcion = 'Gasto — Sueldos — Autónomos Augusto — ARCA período 09/2026, categoría 302 (transacción 3236)'
where id = '4df2d89c-2232-4374-b67e-e1e3dd4796c9' and descripcion like 'Gasto — Impuestos — ARCA Autónomos%';

commit;
