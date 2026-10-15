-- Augusto 14/10/2026: "sacá todos los productos". Los 46 productos de Lazzari cargados el 17/09 (ejemplo, nunca usados en PR)
-- quedan con stock 0 e inactivos. No se borra nada: copia en lz_backup_productos_20261015.
-- Se apaga el trigger stock_bajo_alert solo durante esta tanda para no crear 46 alertas "SIN STOCK".
begin;
create table if not exists public.lz_backup_productos_20261015 as
  select * from public.productos where sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and activo is not false;
alter table public.productos disable trigger stock_bajo_alert;
update public.productos p set stock = 0, activo = false
  from public.lz_backup_productos_20261015 b where b.id = p.id;
alter table public.productos enable trigger stock_bajo_alert;
commit;
