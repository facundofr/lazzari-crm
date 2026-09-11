-- Conserva qué cotización BNA se utilizó al emitir una factura en USD.
alter table public.facturas
  add column if not exists cotizacion_modalidad text;

alter table public.facturas
  drop constraint if exists facturas_cotizacion_modalidad_check;

alter table public.facturas
  add constraint facturas_cotizacion_modalidad_check
  check (cotizacion_modalidad is null or cotizacion_modalidad in ('divisas', 'billetes'));

comment on column public.facturas.cotizacion_modalidad is
  'Modalidad de cotización BNA usada para el tipo_cambio: divisas o billetes';
