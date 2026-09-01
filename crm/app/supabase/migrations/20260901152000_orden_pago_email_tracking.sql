alter table public.ordenes_pago
  add column if not exists email_enviado_at timestamptz;

comment on column public.ordenes_pago.email_enviado_at is
  'Fecha del último envío exitoso de la orden de pago por email desde el CRM.';
