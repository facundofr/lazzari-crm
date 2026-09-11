ALTER TABLE public.remitos
  ADD COLUMN IF NOT EXISTS tipo_remito text;

ALTER TABLE public.remitos
  ADD CONSTRAINT remitos_tipo_remito_check
  CHECK (tipo_remito IS NULL OR tipo_remito IN ('interno', 'muestra', 'electronico'));

COMMENT ON COLUMN public.remitos.tipo_remito IS 'Tipo operativo del remito: interno, muestra o electronico';
