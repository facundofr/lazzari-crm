-- Auditoría de la plata (30/10/2026, Tanda A punto 7, F2): "Viajes y comisiones por ventas — José Enrique Alvarez" ($ 257.100, pagado
-- el 07/09) es la comisión de agosto. Cambia solo el texto ("de agosto 2026"): la Contabilidad la cuenta en agosto. La fecha y el pago
-- quedan como están (Pago de José la sigue viendo como la comisión pagada en septiembre).
-- Vuelta atrás: supabase/rollback/20261030130400_jose_comision_de_agosto.sql
begin;

update public.gastos_manuales
   set descripcion = replace(descripcion, 'Viajes y comisiones por ventas — ', 'Viajes y comisiones por ventas de agosto 2026 — ')
 where id = '8581c9ec-48b2-43e4-988e-4496087a5ee3' and descripcion like 'Viajes y comisiones por ventas — %';

update public.movimientos
   set descripcion = replace(descripcion, 'Viajes y comisiones por ventas — ', 'Viajes y comisiones por ventas de agosto 2026 — ')
 where id = 'bf1972d3-21f0-4794-bb9b-00e354a8a5e6' and descripcion like '%Viajes y comisiones por ventas — %';

commit;
