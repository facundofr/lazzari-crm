-- Vuelta atrás de 20261019220100_delsol_cobro_op_18368.sql: saca el cobro de la OP 18368 y su recibo, y deja el eCheq 3644 como estaba.
begin;
update public.echeqs
   set movimiento_id = null,
       observaciones = 'Paga FC-A 0009-00000405 ($7.394.812,15) y 0009-00000406 ($4.600.666,31) del sistema anterior (total $11.995.478,46). Diferencia $193.792,37: retenciones a confirmar (pedir el martes 13/10). Recibido 09/10/2026 (a confirmar).'
 where id = 'f61d3e1b-7d65-415f-a379-63d2300bf4a6' and movimiento_id = 'c4fbf826-1329-479f-a7d2-085e0f6f015b';
delete from public.recibos where id in (select recibo_id from public.recibo_movimientos
 where movimiento_id in ('c4fbf826-1329-479f-a7d2-085e0f6f015b', '81a748de-6c3e-4708-bddb-cd7905e1433f'));
delete from public.recibo_movimientos where movimiento_id in ('c4fbf826-1329-479f-a7d2-085e0f6f015b', '81a748de-6c3e-4708-bddb-cd7905e1433f');
delete from public.movimientos where id in ('c4fbf826-1329-479f-a7d2-085e0f6f015b', '81a748de-6c3e-4708-bddb-cd7905e1433f');
commit;
