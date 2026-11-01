-- Truck Roque (30/10/2026). Augusto: la entrada de $ 100.000 del 26/10 por Banelco en la caja de ahorro $ "es la de Truck Roque".
-- Es la parte por transferencia del recibo 1079 (FA 0015-00000028, 15/10; las otras dos de $ 100.000 fueron en efectivo). El cobro
-- estaba cargado en la cuenta corriente: queda cruzado con la línea del banco y en la caja de ahorro (aplicar_cruces_extracto pone la
-- cuenta de la línea). No cambia montos, el recibo ni la factura.
-- Respaldo: lz_backup_truck_roque_20261030. Vuelta atrás: supabase/rollback/20261030193200_truck_roque_banelco.sql
begin;

create table if not exists public.lz_backup_truck_roque_20261030 (
  que text primary key,
  fila jsonb not null,
  creado timestamptz not null default now()
);
alter table public.lz_backup_truck_roque_20261030 enable row level security;

insert into public.lz_backup_truck_roque_20261030 (que, fila)
select 'linea', to_jsonb(e) from public.extracto_movimientos e where e.id = '8e9e492e-7e94-4027-942c-8c48d10148eb' on conflict do nothing;
insert into public.lz_backup_truck_roque_20261030 (que, fila)
select 'cobro', to_jsonb(m) from public.movimientos m where m.id = 'bfd96e28-4a72-4f1c-a723-e338daac4ca9' on conflict do nothing;

select set_config('request.jwt.claims', json_build_object('sub', (select id from public.profiles where email = 'augusto@lazzari.com.ar'), 'role', 'authenticated')::text, true);
select public.aplicar_cruces_extracto('eee2a3c8-fe6c-494d-bd2f-7a5d8067d021', jsonb_build_array(jsonb_build_object(
  'linea_id', '8e9e492e-7e94-4027-942c-8c48d10148eb', 'clasificacion', 'cobro', 'movimiento_id', 'bfd96e28-4a72-4f1c-a723-e338daac4ca9',
  'solo_pendiente', true,
  'nota', 'Cobro de Truck Roque Pergamino S. A. por transferencia (recibo 1079, FA 0015-00000028); entró por Banelco a la caja de ahorro el 26/10 (Augusto 30/10/2026).')))
 where exists (select 1 from public.extracto_movimientos where id = '8e9e492e-7e94-4027-942c-8c48d10148eb' and estado::text = 'pendiente')
   and not exists (select 1 from public.extracto_movimientos where match_movimiento_id = 'bfd96e28-4a72-4f1c-a723-e338daac4ca9');

update public.movimientos set extracto_movimiento_id = '8e9e492e-7e94-4027-942c-8c48d10148eb'
 where id = 'bfd96e28-4a72-4f1c-a723-e338daac4ca9' and extracto_movimiento_id is null
   and exists (select 1 from public.extracto_movimientos where id = '8e9e492e-7e94-4027-942c-8c48d10148eb' and match_movimiento_id = 'bfd96e28-4a72-4f1c-a723-e338daac4ca9');

commit;
