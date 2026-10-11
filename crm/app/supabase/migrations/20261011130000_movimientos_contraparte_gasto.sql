-- B10 (seguimiento): el pago de un gasto manual SIN proveedor (viáticos, impuestos, servicios) no entraba a Movimientos.
-- La regla "tiene_contraparte" pedía cliente o proveedor. Ahora también acepta un movimiento atado a su gasto manual.
-- No borra ni modifica datos: la regla nueva es más amplia que la anterior (todo lo que entraba sigue entrando).
-- Para deshacer: supabase/rollback/20261011130000_movimientos_contraparte_gasto.sql
--
-- Se corre entero en el SQL Editor de Supabase. Se puede correr más de una vez.

begin;

alter table public.movimientos drop constraint if exists tiene_contraparte;
alter table public.movimientos add constraint tiene_contraparte
  check (cliente_id is not null or proveedor_id is not null or gasto_manual_id is not null);

comment on constraint tiene_contraparte on public.movimientos is
  'Todo movimiento tiene cliente, proveedor o gasto manual que lo originó.';

commit;
