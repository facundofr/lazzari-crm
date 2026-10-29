-- 29/10/2026: las 3 transferencias del 07/10 (Jerónimo, Mariana y Sebastián) quedaron pendientes en Bancos al anularse sus gastos viejos (H15).
-- Sus pagos ya están cargados por concepto en Gastos (Sueldos y Premios, migración 20261028211000, marca [sueldos-07/10]).
-- Se dejan como "ignorado" con la explicación, para que no aparezcan en Para confirmar (Augusto no quiere confirmar movimientos).
-- Aditivo: solo cambia estado y nota de 3 líneas. Vuelta atrás: supabase/rollback/20261029130000_lineas_sueldos_0710_resueltas.sql
begin;

update public.extracto_movimientos set estado = 'ignorado',
  nota = 'Pago del 07/10 a Sebastián Pereyra: ya cargado en Gastos (Premio agosto $ 400.000; su mutual va aparte).'
where id = '020d8e52-52c1-4850-bcf2-716b7cb59832' and estado = 'pendiente';
update public.extracto_movimientos set estado = 'ignorado',
  nota = 'Pago del 07/10 a Jerónimo Casadidio: ya cargado en Gastos (Premio agosto $ 400.000 + Monotributo $ 61.100 + Mutual $ 128.000).'
where id = '1a22e8f6-3a75-4d60-8936-9ca31046a71e' and estado = 'pendiente';
update public.extracto_movimientos set estado = 'ignorado',
  nota = 'Pago del 07/10 a Mariana Santinelli: ya cargado en Gastos (Premio agosto $ 400.000 + Monotributo $ 61.100 + Mutual $ 128.000).'
where id = '3eff963e-9084-4788-aba4-f373a91e7d1f' and estado = 'pendiente';

commit;
