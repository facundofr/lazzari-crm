-- Vuelta atrás de 20261030130300: los 4 sueldos (y sus pagos) vuelven a decir "— octubre 2026".
begin;
update public.gastos_manuales set descripcion = replace(descripcion, '— septiembre 2026', '— octubre 2026')
 where id in ('1252251b-ab8f-4470-9e88-4c038d3a8447', 'edf96d5d-afc1-42b2-9a85-fcad978d1b91', '530c67be-c831-4e0b-b090-0a488bc44a29', 'fb84468f-0c37-4d0b-b5e7-d6cba20cda48');
update public.movimientos set descripcion = replace(descripcion, '— septiembre 2026', '— octubre 2026')
 where gasto_manual_id in ('1252251b-ab8f-4470-9e88-4c038d3a8447', 'edf96d5d-afc1-42b2-9a85-fcad978d1b91', '530c67be-c831-4e0b-b090-0a488bc44a29', 'fb84468f-0c37-4d0b-b5e7-d6cba20cda48');
commit;
