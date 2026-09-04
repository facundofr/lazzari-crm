-- Add 'pendiente_aprobacion' to facturas_compra estado check constraint
alter table public.facturas_compra drop constraint if exists facturas_compra_estado_check;
alter table public.facturas_compra add constraint facturas_compra_estado_check
  check (estado in ('pendiente', 'pagada', 'anulada', 'recibida', 'pendiente_aprobacion'));
