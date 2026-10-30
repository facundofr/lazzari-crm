-- Vuelta atrás de 20261030130500: el pago de la OP-000001 de Grupo LA (Porcel) vuelve a figurar conciliado.
begin;
update public.movimientos set conciliado = true where id = '3e4ebe86-69c3-4cff-90ff-c7b643ad0417';
-- Al conciliar, la base anota fecha y usuario; antes no tenía ninguno de los dos, así que se vuelven a dejar vacíos.
update public.movimientos set conciliado_at = null, conciliado_por = null where id = '3e4ebe86-69c3-4cff-90ff-c7b643ad0417';
commit;
