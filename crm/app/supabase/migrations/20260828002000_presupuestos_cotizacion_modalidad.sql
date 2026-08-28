-- Conserva si el tipo de cambio USD elegido para el presupuesto fue
-- cotizacion BNA divisa o billete, para mostrarlo correctamente en el PDF.
alter table public.presupuestos
  add column if not exists cotizacion_modalidad text;

update public.presupuestos
set cotizacion_modalidad = 'divisas'
where moneda = 'USD' and cotizacion_modalidad is null;

alter table public.presupuestos
  drop constraint if exists presupuestos_cotizacion_modalidad_check;

alter table public.presupuestos
  add constraint presupuestos_cotizacion_modalidad_check
  check (cotizacion_modalidad is null or cotizacion_modalidad in ('divisas', 'billetes'));

comment on column public.presupuestos.cotizacion_modalidad is
  'Modalidad BNA usada para el tipo de cambio USD: divisas o billetes.';
