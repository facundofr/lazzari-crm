-- Datos bancarios completos solicitados para proveedores.
ALTER TABLE public.proveedores
  ADD COLUMN IF NOT EXISTS titular_cuenta text,
  ADD COLUMN IF NOT EXISTS tipo_cuenta text;

COMMENT ON COLUMN public.proveedores.titular_cuenta IS 'Titular informado por el proveedor';
COMMENT ON COLUMN public.proveedores.tipo_cuenta IS 'CC, CA, CVU u otro tipo de cuenta';
