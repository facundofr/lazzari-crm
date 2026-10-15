-- Vuelta atrás: devuelve stock y activo de los 46 productos desde la copia.
begin;
alter table public.productos disable trigger stock_bajo_alert;
update public.productos p set stock = b.stock, activo = b.activo
  from public.lz_backup_productos_20261015 b where b.id = p.id;
alter table public.productos enable trigger stock_bajo_alert;
commit;
