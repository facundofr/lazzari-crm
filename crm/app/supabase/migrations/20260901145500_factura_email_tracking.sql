-- Registra cuándo una factura fue enviada correctamente desde el CRM.
alter table public.facturas
  add column if not exists email_enviado_at timestamptz;

comment on column public.facturas.email_enviado_at is
  'Último envío exitoso de la factura por email desde el CRM.';
