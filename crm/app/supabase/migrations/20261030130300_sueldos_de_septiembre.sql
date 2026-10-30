-- Auditoría de la plata (30/10/2026, Tanda A punto 7, F2; Augusto 29/10: lo que se paga a principio de mes es el sueldo del mes
-- anterior). Los 4 "Sueldo … — octubre 2026" ($ 9.500.000, pagados el 02/10 y el 10/10) son los de septiembre (sus notas ya lo decían).
-- Cambia solo el texto a "— septiembre 2026": la Contabilidad los cuenta en el mes que nombra el detalle. La fecha y los pagos quedan
-- como están, igual que los sueldos nuevos de "Fijos sin cargar" (así octubre no los vuelve a pedir).
-- Vuelta atrás: supabase/rollback/20261030130300_sueldos_de_septiembre.sql
begin;

update public.gastos_manuales
   set descripcion = replace(descripcion, '— octubre 2026', '— septiembre 2026')
 where id in ('1252251b-ab8f-4470-9e88-4c038d3a8447', 'edf96d5d-afc1-42b2-9a85-fcad978d1b91', '530c67be-c831-4e0b-b090-0a488bc44a29', 'fb84468f-0c37-4d0b-b5e7-d6cba20cda48')
   and descripcion like 'Sueldo % — octubre 2026';

update public.movimientos
   set descripcion = replace(descripcion, '— octubre 2026', '— septiembre 2026')
 where gasto_manual_id in ('1252251b-ab8f-4470-9e88-4c038d3a8447', 'edf96d5d-afc1-42b2-9a85-fcad978d1b91', '530c67be-c831-4e0b-b090-0a488bc44a29', 'fb84468f-0c37-4d0b-b5e7-d6cba20cda48')
   and descripcion like 'Gasto — % — Sueldo % — octubre 2026';

commit;
