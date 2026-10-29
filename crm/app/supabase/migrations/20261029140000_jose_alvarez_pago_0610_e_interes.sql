-- 29/10/2026 (Augusto): José Alvarez tiene tres relaciones con Lazzari: préstamo en US$ (le paga $ 150.000 fijos por mes de interés),
-- transportista interno (los viajes se liquidan en Transportes) y vendedor (comisión = 90% del margen sin IVA de lo que vendió en el mes).
--  1) Gasto fijo nuevo: "Interés préstamo José Alvarez", $ 150.000 por mes (Bancos y financieros).
--  2) El pago del 06/10 ($ 560.000, transferencia #265) se carga por concepto, cada uno con su pago en Movimientos:
--     interés de octubre $ 150.000 (atado al fijo), comisión de septiembre $ 303.048,74 (90% de $ 336.720,82 de margen en FA 15-15 y
--     FA 15-28) y viajes de septiembre $ 106.951,26 (lo que queda; Augusto: "no importa si no da la cuenta").
--  3) La línea del banco de ese pago queda "ignorado" con la explicación (Augusto no quiere confirmar movimientos).
-- Aditivo. Vuelta atrás: supabase/rollback/20261029140000_jose_alvarez_pago_0610_e_interes.sql
begin;

insert into public.gastos_fijos (id, sociedad_id, descripcion, categoria, grupo, monto, moneda, activo, medio_pago, notas)
values ('6a1f0c10-0001-4e00-9a00-0000000000a1', 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021', 'Interés préstamo José Alvarez', 'Financieros',
        'Bancos y financieros', 150000, 'ARS', true, 'transferencia',
        'Interés fijo en pesos del préstamo en US$ que hizo José Alvarez (Augusto 29/10/2026). [jose-alvarez]')
on conflict (id) do nothing;

create temp table _jose (detalle text, categoria text, grupo text, monto numeric, fijo uuid, recurrencia text) on commit drop;
insert into _jose values
  ('Interés préstamo José Alvarez — octubre 2026', 'Financieros', 'Bancos y financieros', 150000,    '6a1f0c10-0001-4e00-9a00-0000000000a1', 'mensual'),
  ('Comisión septiembre 2026 — José Alvarez',      'Comisiones',  'Personal',             303048.74, null, 'eventual'),
  ('Viajes septiembre 2026 — José Alvarez',        'Transportes', 'Operativos',           106951.26, null, 'eventual');

with nuevos as (
  insert into public.gastos_manuales (sociedad_id, fecha, descripcion, categoria, grupo, monto, moneda, medio_pago, tipo_recurrencia, tipo_gasto, gasto_fijo_id, notas)
  select 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021', date '2026-10-06', j.detalle, j.categoria, j.grupo, j.monto, 'ARS', 'transferencia', j.recurrencia, 'general', j.fijo,
         'Parte del pago a José Alvarez del 06/10/2026 ($ 560.000, transferencia #265), según Augusto 29/10/2026. [jose-0610]'
  from _jose j
  where not exists (select 1 from public.gastos_manuales g where g.descripcion = j.detalle and g.sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021')
  returning id, descripcion, grupo, monto, fecha, sociedad_id
)
insert into public.movimientos (tipo, descripcion, monto, moneda, fecha, conciliado, sociedad_id, gasto_manual_id)
select 'pago', 'Gasto — ' || case n.grupo when 'Personal' then 'Sueldos' else n.grupo end || ' — ' || n.descripcion, n.monto, 'ARS', n.fecha, false, n.sociedad_id, n.id
from nuevos n;

update public.extracto_movimientos set estado = 'ignorado',
  nota = 'Pago a José Alvarez del 06/10: ya cargado en Gastos por concepto (interés de octubre $ 150.000, comisión de septiembre $ 303.048,74 y viajes de septiembre $ 106.951,26).'
where id = '6c0e9859-b0ec-4c15-a6fd-e40e63e94a3a' and estado = 'pendiente';

commit;
