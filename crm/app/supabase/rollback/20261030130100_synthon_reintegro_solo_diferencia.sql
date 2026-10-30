-- Vuelta atrás de 20261030130100: el gasto de Synthon vuelve a $ 575.000 con su texto anterior (el pago no se tocó).
begin;
update public.gastos_manuales
   set monto = 575000,
       descripcion = 'Reintegro a Sebastián Pereyra por compras para Synthon',
       notas = regexp_replace(notas, ' · Auditoría de la plata 30/10/2026: la transferencia fue de .*$', '')
 where id = 'c6d4951d-ba21-4651-87a0-a2a16b7b974f';
commit;
