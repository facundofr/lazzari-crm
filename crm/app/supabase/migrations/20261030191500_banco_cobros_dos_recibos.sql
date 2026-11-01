-- Auditoría de la plata, Tanda C, Etapa 0 del banco simple (30/10/2026; Augusto: "Sí, dale a todo"). Solo vínculos.
-- 5 transferencias de clientes que pagaron con DOS recibos (pesos y dólares, o dos OP del cliente) quedaron atadas a mano a uno solo;
-- el otro recibo figuraba como "cargado en el CRM que no pasó por el banco". Cada línea suma exacto sus dos cobros:
--   05/10 Termo 1.422.660,67 = 1.241.525,26 + 181.135,41      14/10 Corteva Seeds 15.830.875,48 = 14.988.785,96 + 842.089,52
--   16/10 Termo 6.157.801,15 = 3.300.199,52 + 2.857.601,63    21/10 Corteva Seeds 1.129.744,03 = 664.620,06 + 465.123,97
--   28/10 Corteva Seeds 3.257.745,49 = 1.621.528,78 + 1.636.216,71
-- El segundo cobro queda apuntando a su línea (como los pagos de varios gastos). No cambia montos, cobros ni facturas.
-- Respaldo: lz_backup_banco_dos_recibos_20261030. Vuelta atrás: supabase/rollback/20261030191500_banco_cobros_dos_recibos.sql
begin;

create table if not exists public.lz_backup_banco_dos_recibos_20261030 (
  id uuid primary key,
  fila jsonb not null,
  creado timestamptz not null default now()
);
alter table public.lz_backup_banco_dos_recibos_20261030 enable row level security;

create temp table _dos (linea uuid, cobro uuid) on commit drop;
insert into _dos values
  ('9c4b1242-85e8-42ba-b74a-aed24adfeaca', '4b466730-48f5-41b9-ac57-82cc7e4d9c45'),
  ('a63ba901-0a3b-47b1-b37b-925408d21f41', '12faa7dd-41a8-4f62-9ab0-4317125b31aa'),
  ('e4ec6651-8dd8-4d5b-8e18-eaddfb29d220', 'dd1bdff0-c999-487c-893c-c70f3b96b5f1'),
  ('f039873f-1581-41cb-a99e-e3ddbb44e4fc', '793aad6b-9eb0-44a6-b7e8-3899605e9eb8'),
  ('4ff1671a-d2d5-40cf-a6aa-805eef545fd3', '0f41a358-1605-4606-8f78-6b466b26f4ce');

-- Control: el cobro atado + el segundo = la línea, y el segundo sigue libre (si no, no se toca nada).
do $$
begin
  if exists (
    select 1 from _dos d join public.extracto_movimientos e on e.id = d.linea
      join public.movimientos a on a.id = e.match_movimiento_id join public.movimientos x on x.id = d.cobro
     where round(a.monto + x.monto, 2) <> round(e.monto, 2) or coalesce(x.anulado, false) or x.extracto_movimiento_id is not null
        or exists (select 1 from public.extracto_movimientos z where z.match_movimiento_id = x.id)
  ) or (select count(*) from _dos d join public.extracto_movimientos e on e.id = d.linea where e.match_movimiento_id is not null) <> 5 then
    raise exception 'Algún cobro no suma exacto o ya está cruzado: no se cambia nada';
  end if;
end $$;

insert into public.lz_backup_banco_dos_recibos_20261030 (id, fila)
select m.id, to_jsonb(m) from public.movimientos m
 where m.id in (select cobro from _dos) or m.id in (select e.match_movimiento_id from public.extracto_movimientos e join _dos d on d.linea = e.id)
on conflict do nothing;

-- Los dos cobros de cada línea apuntan a la línea (el primero también, para que los dos lados queden completos).
update public.movimientos m
   set extracto_movimiento_id = d.linea, conciliado = true,
       conciliado_at = coalesce(m.conciliado_at, now()),
       conciliado_por = coalesce(m.conciliado_por, (select id from public.profiles where email = 'augusto@lazzari.com.ar'))
  from _dos d
 where m.id = d.cobro and m.extracto_movimiento_id is null;
update public.movimientos m
   set extracto_movimiento_id = e.id
  from _dos d join public.extracto_movimientos e on e.id = d.linea
 where m.id = e.match_movimiento_id and m.extracto_movimiento_id is null;

commit;
