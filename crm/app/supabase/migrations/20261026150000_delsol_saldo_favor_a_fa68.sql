-- Del Sol Constructora (Lazzari): aplica el saldo a favor de $ 1.242.839,98 a la FA 0015-00000068.
-- El saldo a favor es lo que pagó de la FA 0015-00000039 anulada (NCA 0015-00000005) en la remesa 0001-00017009.
-- La OP 0001-00018722 (23/10) paga la FA 68 por $ 1.836.717,86 "Pago Final": 3.079.557,84 - 1.242.839,98.
-- Se ata el movimiento de ajuste a la FA 68 (no se crea ni se borra nada): deja de contar como saldo a favor suelto
-- y cuenta como pagado en la FA 68. Vuelta atrás en supabase/rollback/.
begin;
update public.movimientos
   set factura_id = '3764921f-2884-4ca3-8754-7ea28f66865a',
       descripcion = descripcion || ' — aplicado a la FA 0015-00000068 (OP 0001-00018722) [26/10]'
 where id = 'ff39ab9f-80fa-4eed-be82-044c3564b527'
   and factura_id is null and not coalesce(anulado, false);
commit;
