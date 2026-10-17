-- Compras Lazza (Augusto 16/10): marca "Observar" en la factura de compra y en la OC.
-- Se marca cuando la factura no coincide con las OC elegidas y se carga igual; la nota es lo que anotó quien la cargó.
-- Solo AGREGA columnas (con valor por defecto): no cambia ni borra nada de lo que ya existe.
-- Vuelta atrás: supabase/rollback/20261016200000_compras_lazza_observar.sql
begin;

alter table public.facturas_compra
  add column if not exists observar boolean not null default false,
  add column if not exists observar_nota text;

alter table public.ordenes_compra
  add column if not exists observar boolean not null default false,
  add column if not exists observar_nota text;

comment on column public.facturas_compra.observar is 'Compras Lazza: la factura no coincidía con sus OC y se cargó igual (para mirar después).';
comment on column public.ordenes_compra.observar is 'Compras Lazza: la OC quedó con una factura que no coincidía (para mirar después).';

commit;
