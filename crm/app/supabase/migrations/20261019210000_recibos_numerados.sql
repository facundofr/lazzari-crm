-- Recibos numerados (Augusto 18/10 y 19/10/2026, "recibos B"): 1 recibo = 1 cobro.
-- SOLO AGREGA: 2 tablas nuevas, 1 función y 1 trigger. No cambia ni borra ningún movimiento.
--
-- - recibos: un renglón por cobro, con su N° por sociedad (arranca en 1000). Un número nunca se reusa:
--   si se anulan los movimientos, el recibo queda (anulado se ve al leerlo: todos sus movimientos anulados).
-- - recibo_movimientos: qué movimientos (medios y retenciones del cliente) forman cada recibo.
-- - Cobros nuevos: el trigger junta en UN recibo todo lo que se graba para el mismo cliente en la misma
--   operación (misma transacción: el cobro masivo, el de US$ o uno suelto), así cheques + transferencia +
--   retenciones quedan juntos.
-- - Cobros viejos (desde el 22/08): se numeran del más viejo al más nuevo agrupando por la operación que los
--   grabó (cobro_solicitudes / liquidaciones_fx) y, si no hay, por cliente + fecha + moneda.
-- Qué es "cobro de cliente": misma regla que lib/tipos-movimiento.ts (esCobroDeCliente) + las retenciones que
-- nos hizo el cliente; nunca ajustes manuales ni movimientos de proveedores.
-- Vuelta atrás: supabase/rollback/20261019210000_recibos_numerados.sql

create table if not exists public.recibos (
  id uuid primary key default gen_random_uuid(),
  sociedad_id uuid not null references public.sociedades(id),
  numero integer not null,
  cliente_id uuid references public.clientes(id),
  fecha date not null,
  -- Operación (transacción) que lo creó: agrupa los movimientos de un mismo cobro.
  txid bigint,
  created_at timestamptz not null default now(),
  unique (sociedad_id, numero)
);

create table if not exists public.recibo_movimientos (
  recibo_id uuid not null references public.recibos(id) on delete cascade,
  movimiento_id uuid not null references public.movimientos(id) on delete cascade,
  primary key (movimiento_id)
);
create index if not exists recibo_movimientos_recibo_idx on public.recibo_movimientos (recibo_id);
create index if not exists recibos_txid_idx on public.recibos (sociedad_id, cliente_id, txid);

alter table public.recibos enable row level security;
alter table public.recibo_movimientos enable row level security;
revoke all on public.recibos, public.recibo_movimientos from anon, authenticated;
grant select on public.recibos, public.recibo_movimientos to authenticated;
drop policy if exists recibos_select on public.recibos;
create policy recibos_select on public.recibos for select
  using (public.get_my_role() = any (array['super_admin'::user_role, 'admin'::user_role, 'administrativo'::user_role]));
drop policy if exists recibo_movimientos_select on public.recibo_movimientos;
create policy recibo_movimientos_select on public.recibo_movimientos for select
  using (public.get_my_role() = any (array['super_admin'::user_role, 'admin'::user_role, 'administrativo'::user_role]));

-- ¿Este movimiento va en un recibo?
create or replace function public.es_movimiento_de_recibo(m public.movimientos) returns boolean
language sql immutable as $$
  select m.cliente_id is not null and m.proveedor_id is null and m.nota_credito_compra_id is null
    and m.tipo::text in ('cobro','transferencia','efectivo','tarjeta','cheque_recibido','echeq','deposito',
                         'retencion_iva','retencion_ganancias','retencion_iibb','retencion_suss')
    and coalesce(m.descripcion, '') !~* '^\s*\[Ajuste manual\]';
$$;

-- Cobros nuevos: asigna el recibo (el mismo para todo lo del cliente en la misma operación).
create or replace function public.asignar_recibo_movimiento() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare v_recibo uuid; v_tx bigint := txid_current();
begin
  if not public.es_movimiento_de_recibo(new) then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('recibos:' || new.sociedad_id::text, 0));
  select id into v_recibo from public.recibos
  where sociedad_id = new.sociedad_id and cliente_id = new.cliente_id and txid = v_tx
  limit 1;
  if v_recibo is null then
    insert into public.recibos (sociedad_id, numero, cliente_id, fecha, txid)
    values (new.sociedad_id,
            coalesce((select max(numero) from public.recibos where sociedad_id = new.sociedad_id), 999) + 1,
            new.cliente_id, coalesce(new.fecha, current_date), v_tx)
    returning id into v_recibo;
  end if;
  insert into public.recibo_movimientos (recibo_id, movimiento_id) values (v_recibo, new.id)
  on conflict (movimiento_id) do nothing;
  return new;
end;
$$;

drop trigger if exists asignar_recibo_movimiento on public.movimientos;
create trigger asignar_recibo_movimiento after insert on public.movimientos
  for each row execute function public.asignar_recibo_movimiento();

-- Cobros que ya están: numerados del más viejo al más nuevo, desde el 1000, por sociedad.
do $$
declare g record; v_recibo uuid; v_num integer;
begin
  for g in
    with m as (
      select mv.id, mv.sociedad_id, mv.cliente_id, mv.fecha, mv.moneda, mv.created_at, mv.liquidacion_fx_id,
        (select cs.id from public.cobro_solicitudes cs
          where cs.sociedad_id = mv.sociedad_id and cs.resultado->'inserted_ids' ? mv.id::text limit 1) as sol
      from public.movimientos mv
      where public.es_movimiento_de_recibo(mv)
        and not exists (select 1 from public.recibo_movimientos rm where rm.movimiento_id = mv.id)
    )
    select sociedad_id, cliente_id,
      case when sol is not null then 'sol:' || sol
           when liquidacion_fx_id is not null then 'fx:' || liquidacion_fx_id
           else 'cf:' || fecha || ':' || coalesce(moneda, 'ARS') end as clave,
      min(fecha) as fecha, min(created_at) as creado, array_agg(id) as ids
    from m
    group by 1, 2, 3
    order by sociedad_id, min(fecha), min(created_at)
  loop
    select coalesce(max(numero), 999) + 1 into v_num from public.recibos where sociedad_id = g.sociedad_id;
    insert into public.recibos (sociedad_id, numero, cliente_id, fecha, created_at)
    values (g.sociedad_id, v_num, g.cliente_id, g.fecha, g.creado)
    returning id into v_recibo;
    insert into public.recibo_movimientos (recibo_id, movimiento_id)
    select v_recibo, unnest(g.ids);
  end loop;
end $$;
