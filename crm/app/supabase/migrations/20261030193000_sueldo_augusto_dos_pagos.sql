-- Sueldo de Augusto de septiembre (30/10/2026). Augusto: "solo cobré 1.000.000" / "me voy a transferir el resto del sueldo a mi
-- cuenta de galicia así lo cobro completo". El gasto queda en $ 5.000.000 y se paga en 2 partes:
--   · el pago que ya existe pasa de $ 5.000.000 a $ 1.000.000 (es la transferencia del 16/10, ya cruzada con el banco);
--   · un pago nuevo de $ 4.000.000 del 30/10 (transferencia a su cuenta del Galicia), sin cruzar: cuando se suba el extracto con esa
--     transferencia, el banco simple lo cruza solo (CUIT de Augusto e importe exacto).
-- Respaldo: lz_backup_sueldo_augusto_20261030. Vuelta atrás: supabase/rollback/20261030193000_sueldo_augusto_dos_pagos.sql
begin;

create table if not exists public.lz_backup_sueldo_augusto_20261030 (
  que text primary key,
  fila jsonb not null,
  creado timestamptz not null default now()
);
alter table public.lz_backup_sueldo_augusto_20261030 enable row level security;

do $$
declare
  v_pago public.movimientos%rowtype;
  v_nuevo uuid;
begin
  select * into v_pago from public.movimientos where id = '43c2106f-9e28-413d-9ff5-a84b38947027' for update;
  if not found or round(v_pago.monto, 2) <> 5000000 or coalesce(v_pago.anulado, false) then
    raise exception 'El pago del sueldo de septiembre ya no está como antes: no se cambia nada';
  end if;
  insert into public.lz_backup_sueldo_augusto_20261030 (que, fila) values ('pago', to_jsonb(v_pago)) on conflict do nothing;
  insert into public.lz_backup_sueldo_augusto_20261030 (que, fila)
  select 'gasto', to_jsonb(g) from public.gastos_manuales g where g.id = '530c67be-c831-4e0b-b090-0a488bc44a29' on conflict do nothing;

  update public.movimientos set monto = 1000000 where id = v_pago.id;

  insert into public.movimientos (tipo, descripcion, monto, moneda, fecha, conciliado, gasto_manual_id, sociedad_id, cuenta_id, created_by)
  values ('pago', 'Gasto — Personal — Sueldo Augusto — septiembre 2026 (resto: transferencia a su cuenta del Galicia)', 4000000, 'ARS',
          '2026-10-30', false, '530c67be-c831-4e0b-b090-0a488bc44a29', v_pago.sociedad_id, v_pago.cuenta_id,
          (select id from public.profiles where email = 'augusto@lazzari.com.ar'))
  returning id into v_nuevo;
  insert into public.lz_backup_sueldo_augusto_20261030 (que, fila) values ('pago_nuevo', jsonb_build_object('id', v_nuevo)) on conflict do nothing;

  update public.gastos_manuales
     set notas = concat_ws(' · ', nullif(notas, ''), 'Pagado en 2 partes: $ 1.000.000 el 16/10 y $ 4.000.000 el 30/10 (transferencia a su cuenta del Galicia).')
   where id = '530c67be-c831-4e0b-b090-0a488bc44a29' and coalesce(notas, '') not like '%Pagado en 2 partes%';
end $$;

commit;
