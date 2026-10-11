-- Vuelta atrás de 20261011180000_extractos_bbva.sql
-- Saca las funciones, la tabla de reglas y las columnas nuevas.
-- ⚠️ Se pierde la clasificación de las líneas del extracto, el saldo del banco de cada cuenta y la marca
--    "lo cubre" de los cheques. Las líneas importadas, los cheques agregados y las conciliaciones de
--    movimientos quedan (no se borran datos de plata).
begin;

drop function if exists public.completar_cheques_emitidos(uuid, jsonb);
drop function if exists public.aplicar_cruces_extracto(uuid, jsonb);
drop function if exists public.importar_extracto_bbva(uuid, uuid, text, jsonb, numeric, date);

drop index if exists public.echeqs_cubre_tercero_idx;
alter table public.echeqs drop column if exists cubierto_at;
alter table public.echeqs drop column if exists cubre_tercero;

drop table if exists public.extracto_reglas;

alter table public.cuentas_financieras drop column if exists saldo_banco_fecha;
alter table public.cuentas_financieras drop column if exists saldo_banco;

drop index if exists public.extracto_movimientos_cheque_unique;
drop index if exists public.extracto_movimientos_cuenta_fecha_idx;
drop index if exists public.extracto_movimientos_clave_unique;
alter table public.extracto_movimientos drop constraint if exists extracto_movimientos_clasificacion_check;
alter table public.extracto_movimientos
  drop column if exists clasificado_at,
  drop column if exists clasificado_por,
  drop column if exists nota,
  drop column if exists contra_cuenta_id,
  drop column if exists cheque_id,
  drop column if exists subtipo,
  drop column if exists clasificacion,
  drop column if exists clave,
  drop column if exists sucursal,
  drop column if exists saldo,
  drop column if exists cuenta_id;

commit;
