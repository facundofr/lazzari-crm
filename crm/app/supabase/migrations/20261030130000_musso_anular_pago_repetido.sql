-- Auditoría de la plata (30/10/2026, Tanda A punto 7, D4): los honorarios de Musso de octubre se pagaron UNA vez, con la OP-000063
-- (FC 0001-00000556, cruzada con el banco el 14/10). El gasto fijo "Honorarios contador (Agustín Musso) — octubre 2026" creó además
-- su propio pago de $ 178.200 (20/10, sin línea del banco). Ese pago se anula, igual que «Anular» en Movimientos (queda el registro
-- anulado). El gasto NO se toca: sigue contando en el resultado.
-- Vuelta atrás: supabase/rollback/20261030130000_musso_anular_pago_repetido.sql
begin;

select set_config('request.jwt.claims', json_build_object('sub', (select id from public.profiles where email = 'augusto@lazzari.com.ar'), 'role', 'authenticated')::text, true);
select public.gestionar_cobro('7c4e7830-49c9-448c-806f-3b0e430ab25d'::uuid, 'anular')
 where exists (select 1 from public.movimientos where id = '7c4e7830-49c9-448c-806f-3b0e430ab25d' and not coalesce(anulado, false));

update public.gastos_manuales
   set notas = concat_ws(' · ', nullif(notas, ''), 'Pagado con la OP-000063 (FC 0001-00000556). Su pago propio de $ 178.200 del 20/10 se anuló porque la plata salió una sola vez (auditoría de la plata 30/10/2026).')
 where id = '6e40fe0a-b1de-4939-bafc-eda778e9feb6' and coalesce(notas, '') not like '%auditoría de la plata 30/10/2026%';

commit;
