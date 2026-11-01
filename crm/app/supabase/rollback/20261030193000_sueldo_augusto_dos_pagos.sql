-- Vuelta atrás de 20261030193000_sueldo_augusto_dos_pagos.sql: se borra el pago nuevo de $ 4.000.000 (si todavía no se cruzó con
-- el banco; si ya se cruzó, primero hay que desatar la línea) y el pago y el gasto vuelven a como estaban.
begin;

delete from public.movimientos m
 where m.id = (select (fila->>'id')::uuid from public.lz_backup_sueldo_augusto_20261030 where que = 'pago_nuevo')
   and m.extracto_movimiento_id is null
   and not exists (select 1 from public.extracto_movimientos e where e.match_movimiento_id = m.id);

update public.movimientos m set monto = r.monto
  from public.lz_backup_sueldo_augusto_20261030 b, jsonb_populate_record(null::public.movimientos, b.fila) r
 where b.que = 'pago' and m.id = r.id;

update public.gastos_manuales g set notas = r.notas
  from public.lz_backup_sueldo_augusto_20261030 b, jsonb_populate_record(null::public.gastos_manuales, b.fila) r
 where b.que = 'gasto' and g.id = r.id;

commit;
