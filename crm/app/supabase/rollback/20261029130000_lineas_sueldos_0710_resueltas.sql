-- Vuelta atrás de 20261029130000: las 3 líneas vuelven a pendiente con su nota anterior.
begin;
update public.extracto_movimientos set estado = 'pendiente', nota = 'Gasto: Premio agosto — Sebastián Pereyra' where id = '020d8e52-52c1-4850-bcf2-716b7cb59832';
update public.extracto_movimientos set estado = 'pendiente', nota = 'Gasto: Premio agosto + monotributo + obra social — Jerónimo Casadidio' where id = '1a22e8f6-3a75-4d60-8936-9ca31046a71e';
update public.extracto_movimientos set estado = 'pendiente', nota = 'Gasto: Premio agosto + monotributo + obra social — Mariana Santinelli' where id = '3eff963e-9084-4788-aba4-f373a91e7d1f';
commit;
