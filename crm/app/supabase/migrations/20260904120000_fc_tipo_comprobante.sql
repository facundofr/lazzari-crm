-- Tipo de comprobante de compra: FC A, FC B, FC C, FC Manual, ND, NC, etc.
alter table public.facturas_compra
  add column if not exists tipo_comprobante text not null default 'FC A';
