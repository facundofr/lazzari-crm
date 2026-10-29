-- 28/10/2026 (Augusto): el pago a Gaspar Federico Ovando ($ 2.680.080, 22/09, mercadería importada) ya está en el costo de los PR (el costo de lista
-- de lo que se vende, ej. PR-2026-1062): se saca de Gastos para no contarlo dos veces. Hace lo mismo que "Borrar gasto" en Gastos: anula su pago en Movimientos
-- (queda el registro anulado) y borra el gasto; con la corrección 20261028160000 la línea del banco vuelve a "pendiente" (hay que clasificarla en Bancos > Movimientos).
-- Vuelta atrás: supabase/rollback/20261028240000_borrar_pago_ovando_ya_en_costo.sql
begin;

select set_config('request.jwt.claims', json_build_object('sub', (select id from public.profiles where role::text = 'super_admin' and coalesce(active, true) limit 1), 'role', 'authenticated')::text, true);
select public.gestionar_cobro('c338e6df-80d7-4c04-9f4c-6fe0c4c97a92'::uuid, 'anular');
delete from public.gastos_manuales where id = '8a9fd4d3-f421-4324-a035-b70d9044af96';

commit;
