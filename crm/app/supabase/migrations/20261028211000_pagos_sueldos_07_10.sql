-- 28/10/2026 (Augusto): "les pagué todo". Se cargan los pagos del 07/10/2026 a Jerónimo, Mariana y Sebastián, por concepto:
-- Sueldos (monotributo, mutual) y Premios (el premio de agosto, que se paga con el sueldo del mes siguiente). Transferencia, sin vincular a la línea del banco.
-- Jerónimo y Mariana: 400.000 premio + 61.100 monotributo + 128.000 mutual = 589.100 cada uno (lo transferido). Sebastián: 400.000 premio + 128.000 mutual.
-- Cada gasto lleva su pago en Movimientos (igual que cargarlo desde Gastos). Aditivo. Vuelta atrás: supabase/rollback/20261028211000_pagos_sueldos_07_10.sql
begin;

create temp table _pagos_sueldos (detalle text, categoria text, grupo text, monto numeric) on commit drop;
insert into _pagos_sueldos values
  ('Premio agosto — Jerónimo Casadidio',          'Premios', 'Premios',  400000),
  ('Monotributo — Jerónimo Casadidio',            'Sueldos', 'Personal',  61100),
  ('Mutual — Jerónimo Casadidio',                 'Sueldos', 'Personal', 128000),
  ('Premio agosto — Mariana Santinelli',          'Premios', 'Premios',  400000),
  ('Monotributo — Mariana Santinelli',            'Sueldos', 'Personal',  61100),
  ('Mutual — Mariana Santinelli',                 'Sueldos', 'Personal', 128000),
  ('Premio agosto — Sebastián Pereyra',           'Premios', 'Premios',  400000),
  ('Mutual — Sebastián Pereyra',                  'Sueldos', 'Personal', 128000);

with nuevos as (
  insert into public.gastos_manuales (sociedad_id, fecha, descripcion, categoria, grupo, monto, moneda, medio_pago, tipo_gasto, notas)
  select 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021'::uuid, date '2026-10-07', p.detalle, p.categoria, p.grupo, p.monto, 'ARS', 'transferencia', 'general',
         'Pagado el 07/10/2026 por transferencia (según Augusto 28/10/2026). [sueldos-07/10]'
  from _pagos_sueldos p
  where not exists (select 1 from public.gastos_manuales g where g.descripcion = p.detalle and g.fecha = date '2026-10-07')
  returning id, descripcion, categoria, monto, fecha, sociedad_id, grupo
)
insert into public.movimientos (tipo, descripcion, monto, moneda, fecha, conciliado, sociedad_id, gasto_manual_id)
select 'pago', 'Gasto — ' || case n.grupo when 'Personal' then 'Sueldos' else n.grupo end || ' — ' || n.descripcion, n.monto, 'ARS', n.fecha, false, n.sociedad_id, n.id
from nuevos n;

commit;
