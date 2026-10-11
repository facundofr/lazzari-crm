-- Las anulaciones de Finanzas (cobros, órdenes de pago, NC de compra, pagos de gastos) dejan el movimiento con monto 0
-- y anulado = true. Dos reglas creadas a mano en la base lo impedían:
--  · monto_positivo (monto > 0): ahora un movimiento ANULADO puede quedar en 0.
--  · tiene_contraparte: un movimiento ANULADO puede quedar sin cliente/proveedor/gasto (p. ej. al borrar el gasto ya anulado).
-- Los movimientos vigentes siguen igual de controlados. No borra ni modifica datos.
-- Para deshacer: supabase/rollback/20261011140000_movimientos_anulados_reglas.sql
--
-- Se corre entero en el SQL Editor de Supabase. Se puede correr más de una vez.

begin;

alter table public.movimientos drop constraint if exists monto_positivo;
alter table public.movimientos add constraint monto_positivo
  check (monto > 0 or (coalesce(anulado, false) and monto = 0));

alter table public.movimientos drop constraint if exists tiene_contraparte;
alter table public.movimientos add constraint tiene_contraparte
  check (cliente_id is not null or proveedor_id is not null or gasto_manual_id is not null or coalesce(anulado, false));

comment on constraint monto_positivo on public.movimientos is
  'Monto mayor a cero; un movimiento anulado queda en 0 (el importe original está en monto_original).';
comment on constraint tiene_contraparte on public.movimientos is
  'Todo movimiento vigente tiene cliente, proveedor o gasto manual que lo originó.';

commit;
