-- Auditoría de la plata, Tanda C, Etapa 0 del banco simple (30/10/2026; Augusto: "Sí, dale a todo").
-- La comisión del banco por el cheque devuelto de Barraza N° 131 (20/10: comisión $ 80.883,93 + IVA $ 16.985,62, dos líneas del
-- BBVA CC EPP) estaba además cargada a mano en Gastos ("Comisión gestión de cheques BBVA Nro 09191840", $ 97.869,55, con su pago
-- cruzado con la línea de la comisión). Las comisiones del banco salen de las líneas del banco (la Contabilidad y Reportes ya las
-- leen), así que se saca el gasto cargado a mano igual que «Borrar» en Gastos (borrar_gasto: anula su pago, queda el registro
-- anulado, y borra el gasto) y la línea de la comisión queda "del banco" con su nota.
-- Efecto en octubre: la comisión cuenta $ 80.883,93 desde el banco y el IVA $ 16.985,62 queda como IVA del banco (crédito fiscal,
-- fuera del resultado). Antes contaba $ 97.869,55 y el IVA aparecía dos veces.
-- Respaldo: lz_backup_comision_cheques_20261030 (gasto, pago y las 2 líneas como estaban).
-- Vuelta atrás: supabase/rollback/20261030190000_comision_cheques_del_banco.sql
begin;

create table if not exists public.lz_backup_comision_cheques_20261030 (
  que text primary key,
  fila jsonb not null,
  creado timestamptz not null default now()
);
alter table public.lz_backup_comision_cheques_20261030 enable row level security;

insert into public.lz_backup_comision_cheques_20261030 (que, fila)
select 'gasto', to_jsonb(g) from public.gastos_manuales g where g.id = 'c19763c3-e20f-4e09-986f-dc283a2a3a4c'
on conflict (que) do nothing;
insert into public.lz_backup_comision_cheques_20261030 (que, fila)
select 'pago', to_jsonb(m) from public.movimientos m where m.id = '846e2040-6a8d-4a46-af30-e3442062ab0c'
on conflict (que) do nothing;
insert into public.lz_backup_comision_cheques_20261030 (que, fila)
select 'linea_comision', to_jsonb(e) from public.extracto_movimientos e where e.id = '9ceccf09-1f23-40b1-8e58-373ce5ab1658'
on conflict (que) do nothing;
insert into public.lz_backup_comision_cheques_20261030 (que, fila)
select 'linea_iva', to_jsonb(e) from public.extracto_movimientos e where e.id = '02e41065-3d24-48cd-b58a-773b1dda9c1c'
on conflict (que) do nothing;

-- Como «Borrar» en Gastos, con el usuario de Augusto.
select set_config('request.jwt.claims', json_build_object('sub', (select id from public.profiles where email = 'augusto@lazzari.com.ar'), 'role', 'authenticated')::text, true);
select public.borrar_gasto('c19763c3-e20f-4e09-986f-dc283a2a3a4c'::uuid)
 where exists (select 1 from public.gastos_manuales where id = 'c19763c3-e20f-4e09-986f-dc283a2a3a4c');

-- Las 2 líneas quedan "del banco" (no se manda nada a confirmar).
update public.extracto_movimientos
   set estado = 'matcheado', clasificacion = 'gasto_bancario', subtipo = 'comision', match_movimiento_id = null,
       nota = 'Comisión del banco por el cheque de Barraza N° 131 devuelto: $ 80.883,93 (el IVA va en su propia línea). Sale del banco; el gasto que estaba cargado a mano se sacó el 30/10/2026 para no contarla dos veces (auditoría de la plata).'
 where id = '9ceccf09-1f23-40b1-8e58-373ce5ab1658';
update public.extracto_movimientos
   set estado = 'matcheado', clasificacion = 'impuesto', subtipo = 'iva', match_movimiento_id = null,
       nota = 'IVA 21 % sobre la comisión del banco por el cheque de Barraza N° 131 devuelto: $ 16.985,62 (IVA del banco, crédito fiscal).'
 where id = '02e41065-3d24-48cd-b58a-773b1dda9c1c';

commit;
