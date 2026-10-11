-- Deshace 20261011140000_movimientos_anulados_reglas.sql
-- Vuelve monto_positivo a "monto > 0" y tiene_contraparte a la versión de 20261011130000.
-- ATENCIÓN:
--  · Va con NOT VALID: los movimientos ya anulados (monto 0) quedan como están.
--  · Desde ese momento, las anulaciones de Finanzas vuelven a fallar.

begin;

alter table public.movimientos drop constraint if exists monto_positivo;
alter table public.movimientos add constraint monto_positivo
  check (monto > 0) not valid;

alter table public.movimientos drop constraint if exists tiene_contraparte;
alter table public.movimientos add constraint tiene_contraparte
  check (cliente_id is not null or proveedor_id is not null or gasto_manual_id is not null) not valid;

commit;
