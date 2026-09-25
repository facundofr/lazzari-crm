begin;

alter table public.muestra_envios
  add column if not exists fecha_devolucion date,
  add column if not exists moneda text not null default 'ARS';

alter table public.muestra_envios
  drop constraint if exists muestra_envios_moneda_check;
alter table public.muestra_envios
  add constraint muestra_envios_moneda_check check (moneda in ('ARS', 'USD'));

alter table public.muestra_envio_items
  add column if not exists precio_unitario numeric(15,2)
  check (precio_unitario is null or precio_unitario >= 0);

comment on column public.muestra_envios.fecha_devolucion is
  'Fecha de la devolución más reciente; al completar el envío representa la devolución final.';
comment on column public.muestra_envios.moneda is
  'Moneda de los precios opcionales informados para las muestras.';
comment on column public.muestra_envio_items.precio_unitario is
  'Precio informativo opcional de la muestra al momento de la entrega.';

commit;
