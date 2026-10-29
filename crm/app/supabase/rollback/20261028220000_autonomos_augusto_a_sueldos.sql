-- Vuelta atrás de 20261028220000: el pago de Autónomos vuelve a Impuestos con su texto original.
begin;
update public.gastos_manuales set categoria = 'Impuestos', grupo = 'Impuestos', descripcion = 'ARCA Autónomos — período 09/2026, categoría 302 (transacción 3236)' where id = '8ddf6090-ebb8-4662-9bb4-4b095bb38e6b';
update public.movimientos set descripcion = 'Gasto — Impuestos — ARCA Autónomos — período 09/2026, categoría 302 (transacción 3236)' where id = '4df2d89c-2232-4374-b67e-e1e3dd4796c9';
commit;
