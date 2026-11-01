-- Prueba de 20261030193000_sueldo_augusto_dos_pagos.sql (con --probar: siempre se deshace), con la vuelta atrás al final.
select 'pagos' q, m.monto, m.fecha::date, m.conciliado, m.extracto_movimiento_id is not null atado from movimientos m where m.gasto_manual_id = '530c67be-c831-4e0b-b090-0a488bc44a29' and not coalesce(m.anulado,false) order by m.monto;
select 'gasto' q, monto, right(notas, 60) notas from gastos_manuales where id = '530c67be-c831-4e0b-b090-0a488bc44a29';
-- Vuelta atrás de 20261030193000_sueldo_augusto_dos_pagos.sql: se borra el pago nuevo de $ 4.000.000 (si todavía no se cruzó con
-- el banco; si ya se cruzó, primero hay que desatar la línea) y el pago y el gasto vuelven a como estaban.

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

select 'vuelta' q, count(*) pagos, sum(m.monto) total, bool_and(to_jsonb(m) = (select fila from lz_backup_sueldo_augusto_20261030 where que = 'pago')) identico from movimientos m where m.gasto_manual_id = '530c67be-c831-4e0b-b090-0a488bc44a29' and not coalesce(m.anulado,false);
select 'vuelta_gasto' q, (to_jsonb(g) = (select fila from lz_backup_sueldo_augusto_20261030 where que = 'gasto')) identico from gastos_manuales g where g.id = '530c67be-c831-4e0b-b090-0a488bc44a29';
