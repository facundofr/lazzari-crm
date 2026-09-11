-- Trazabilidad fiscal de pagos directos sin OP.
alter table public.movimientos
  add column if not exists base_retencion_ganancias numeric(14,2) not null default 0,
  add column if not exists retencion_ganancias_pct numeric(8,4) not null default 0,
  add column if not exists retencion_ganancias_monto numeric(14,2) not null default 0;

create index if not exists movimientos_retenciones_mes_idx
  on public.movimientos (sociedad_id, proveedor_id, fecha)
  where tipo = 'pago' and retencion_ganancias_monto > 0;
