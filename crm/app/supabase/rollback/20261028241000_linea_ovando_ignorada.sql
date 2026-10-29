-- Vuelta atrás de 20261028241000: la línea vuelve a pendiente con su nota anterior.
begin;
update public.extracto_movimientos set estado = 'pendiente', nota = 'Pago por transferencia: $ 2.680.080,00 — Pago por importación — Gaspar Federico Ovando' where id = '0ffb1b73-7941-4654-a489-0871bd69b5ea';
commit;
