alter table public.transportes
  add column if not exists factura_compra_id uuid
  references public.facturas_compra(id) on delete set null;

create index if not exists idx_transportes_factura_compra_id
  on public.transportes(factura_compra_id)
  where factura_compra_id is not null;

comment on column public.transportes.factura_compra_id is
  'Factura de compra enviada a Finanzas para pagar este viaje o lote de viajes.';
