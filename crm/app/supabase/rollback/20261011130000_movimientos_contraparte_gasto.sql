-- Deshace 20261011130000_movimientos_contraparte_gasto.sql
-- Vuelve la regla "tiene_contraparte" a pedir cliente o proveedor.
-- ATENCIÓN:
--  · Va con NOT VALID: los pagos de gastos sin proveedor que ya se cargaron quedan como están (no se borran).
--  · Desde ese momento, los gastos sin proveedor vuelven a guardarse sin su pago en Movimientos.

begin;

alter table public.movimientos drop constraint if exists tiene_contraparte;
alter table public.movimientos add constraint tiene_contraparte
  check (cliente_id is not null or proveedor_id is not null) not valid;

commit;
