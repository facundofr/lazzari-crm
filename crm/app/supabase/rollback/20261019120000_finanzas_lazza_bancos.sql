-- Vuelta atrás de 20261019120000_finanzas_lazza_bancos.sql: saca solo lo que agregó esa migración.
-- Los pagos anotados en los préstamos de la familia se borran con ellos (cuotas en cascada).
-- No toca los créditos BNA ni ninguna otra cuenta.
begin;
drop table if exists public.tarjeta_resumenes;
delete from public.cuentas_financieras where id = '6c0a1b20-0001-4e00-9a00-000000000001';
delete from public.prestamos where id in (
  '9b1a0c10-0001-4e00-9a00-000000000003',
  '9b1a0c10-0001-4e00-9a00-000000000004',
  '9b1a0c10-0001-4e00-9a00-000000000005'
);
alter table public.prestamos drop constraint if exists prestamos_sentido_check;
alter table public.prestamos drop column if exists sentido;
commit;
