-- Permite registrar un pago parcial directamente contra una factura de compra,
-- sin crear una orden de pago. El movimiento conserva trazabilidad y sociedad.
alter table public.movimientos
  add column if not exists factura_compra_id uuid references public.facturas_compra(id) on delete set null;

create index if not exists movimientos_factura_compra_id_idx
  on public.movimientos (factura_compra_id)
  where factura_compra_id is not null;

comment on column public.movimientos.factura_compra_id is
  'Factura de compra a la que se aplica un pago directo; no implica una orden de pago.';
