-- Vuelta atrás de 20261030130400: la comisión de José (y su pago) vuelven al texto anterior.
begin;
update public.gastos_manuales set descripcion = replace(descripcion, 'Viajes y comisiones por ventas de agosto 2026 — ', 'Viajes y comisiones por ventas — ')
 where id = '8581c9ec-48b2-43e4-988e-4496087a5ee3';
update public.movimientos set descripcion = replace(descripcion, 'Viajes y comisiones por ventas de agosto 2026 — ', 'Viajes y comisiones por ventas — ')
 where id = 'bf1972d3-21f0-4794-bb9b-00e354a8a5e6';
commit;
