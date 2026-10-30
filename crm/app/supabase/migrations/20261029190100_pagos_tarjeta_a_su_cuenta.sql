-- Auditoría de la plata (29/10/2026, Tanda A punto 3, datos): los 10 pagos de gastos con tarjeta que la base había puesto en el
-- banco pasan a la cuenta de su tarjeta (Visa ·1582 o Mastercard ·4775): 5 en $ estaban en la CC EPP y 5 en US$ en la Caja de
-- ahorro U$S. Ninguno está unido a una línea del extracto, así que no queda nada pendiente en el banco.
-- No se borra nada: la cuenta anterior queda guardada en lz_backup_pagos_tarjeta_20261029.
-- Vuelta atrás: supabase/rollback/20261029190100_pagos_tarjeta_a_su_cuenta.sql
begin;

create table if not exists public.lz_backup_pagos_tarjeta_20261029 (
  movimiento_id uuid primary key,
  cuenta_id_antes uuid,
  cuenta_id_nueva uuid not null,
  guardado_at timestamptz not null default now()
);
alter table public.lz_backup_pagos_tarjeta_20261029 enable row level security;

with destino as (
  select m.id, m.cuenta_id as antes, (
    select c.id
      from public.cuentas_financieras c
     where c.sociedad_id = m.sociedad_id
       and c.tipo = 'tarjeta_credito'
       and coalesce(c.activa, true)
       and c.nombre ~ (right(g.medio_pago, 4) || '\s*$')
     order by c.orden nulls last, c.created_at
     limit 1) as nueva
  from public.movimientos m
  join public.gastos_manuales g on g.id = m.gasto_manual_id
  join public.cuentas_financieras cb on cb.id = m.cuenta_id
  where g.medio_pago ~ '^tarjeta_[a-z]+_[0-9]{4}$'
    and not coalesce(m.anulado, false)
    and cb.tipo in ('cuenta_corriente', 'caja_ahorro')
    and not exists (select 1 from public.extracto_movimientos e where e.match_movimiento_id = m.id)
)
insert into public.lz_backup_pagos_tarjeta_20261029 (movimiento_id, cuenta_id_antes, cuenta_id_nueva)
select id, antes, nueva from destino where nueva is not null
on conflict (movimiento_id) do nothing;

update public.movimientos m
   set cuenta_id = b.cuenta_id_nueva
  from public.lz_backup_pagos_tarjeta_20261029 b
 where b.movimiento_id = m.id
   and m.cuenta_id is not distinct from b.cuenta_id_antes;

-- Control: son 10 (revisado el 29/10 en solo lectura). Si no da, no se cambia nada.
do $$
declare n int;
begin
  select count(*) into n from public.lz_backup_pagos_tarjeta_20261029;
  if n <> 10 then
    raise exception 'Se esperaban 10 pagos con tarjeta para mover y hay %', n;
  end if;
end $$;

commit;
