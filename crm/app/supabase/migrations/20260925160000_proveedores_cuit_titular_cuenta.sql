-- Identificación del titular bancario, separada del CUIT fiscal del proveedor.
ALTER TABLE public.proveedores
  ADD COLUMN IF NOT EXISTS cuit_titular_cuenta text;

COMMENT ON COLUMN public.proveedores.cuit_titular_cuenta IS
  'CUIT o CUIL opcional del titular de la cuenta bancaria; no reemplaza el CUIT fiscal del proveedor';
