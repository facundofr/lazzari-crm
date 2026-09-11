-- Art. 29 RG 830: importe mínimo de retención a practicar.
-- Se separa del mínimo mensual no imponible (minimo_ganancias).
alter table public.retencion_config
  add column if not exists minimo_retencion_ganancias numeric(14,2) not null default 240;

comment on column public.retencion_config.minimo_retencion_ganancias is
  'Importe mínimo de retención de Ganancias a practicar por operación (Art. 29 RG 830).';
