-- Vuelta atrás de 20261029190100_pagos_tarjeta_a_su_cuenta.sql: cada pago vuelve a la cuenta que tenía (guardada en
-- lz_backup_pagos_tarjeta_20261029). La tabla de respaldo queda (no se borra nada).
begin;

update public.movimientos m
   set cuenta_id = b.cuenta_id_antes
  from public.lz_backup_pagos_tarjeta_20261029 b
 where b.movimiento_id = m.id
   and m.cuenta_id = b.cuenta_id_nueva;

commit;
