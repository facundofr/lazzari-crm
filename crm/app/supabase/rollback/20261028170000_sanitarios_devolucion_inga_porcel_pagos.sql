-- Vuelta atrás de 20261028170000: borra solo los 3 movimientos que agregó esa migración.
begin;
delete from public.movimientos where tipo = 'ajuste' and descripcion like '[Ajuste manual] Devolución de Sanitarios San Martín%';
delete from public.movimientos where tipo = 'pago' and gasto_manual_id in ('48d20099-a38b-49ed-abdb-c9b87bee4fa5','d41a42d0-c434-451d-aac8-c871cd77d00e')
  and descripcion like 'Pago — %Es el mismo pago del gasto de octubre.';
commit;
