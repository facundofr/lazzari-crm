-- Vuelta atrás de 20261019220000_delsol_cobro_op_18326.sql: saca el cobro de la OP 18326 y su recibo, y desata el eCheq 3587.
begin;
update public.echeqs set movimiento_id = null
 where id = '436e0a87-0b5f-462e-b9b1-48b95e9a0d67' and movimiento_id = 'a372f7fb-8e17-46f4-b97e-ebc0b79d3bec';
delete from public.recibos where id in (select recibo_id from public.recibo_movimientos
 where movimiento_id in ('a372f7fb-8e17-46f4-b97e-ebc0b79d3bec', 'b3b9e4d9-2bda-4e05-b6b6-3d354f95c5c9'));
delete from public.recibo_movimientos where movimiento_id in ('a372f7fb-8e17-46f4-b97e-ebc0b79d3bec', 'b3b9e4d9-2bda-4e05-b6b6-3d354f95c5c9');
delete from public.movimientos where id in ('a372f7fb-8e17-46f4-b97e-ebc0b79d3bec', 'b3b9e4d9-2bda-4e05-b6b6-3d354f95c5c9');
commit;
