-- Vuelta atrás de 20261026150000_delsol_saldo_favor_a_fa68.sql: el saldo a favor de Del Sol vuelve a quedar suelto.
begin;
update public.movimientos
   set factura_id = null,
       descripcion = replace(descripcion, ' — aplicado a la FA 0015-00000068 (OP 0001-00018722) [26/10]', '')
 where id = 'ff39ab9f-80fa-4eed-be82-044c3564b527'
   and factura_id = '3764921f-2884-4ca3-8754-7ea28f66865a';
commit;
