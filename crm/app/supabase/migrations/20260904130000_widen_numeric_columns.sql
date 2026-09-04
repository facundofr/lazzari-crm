-- Ampliar columnas numeric para soportar valores grandes (ej: precios en ARS > 10M)
-- presupuesto_items
ALTER TABLE public.presupuesto_items
  ALTER COLUMN precio_costo TYPE numeric(15,2),
  ALTER COLUMN precio_venta TYPE numeric(15,2),
  ALTER COLUMN subtotal TYPE numeric(15,2),
  ALTER COLUMN iva TYPE numeric(15,2),
  ALTER COLUMN total TYPE numeric(15,2),
  ALTER COLUMN markup_porcentaje TYPE numeric(10,2),
  ALTER COLUMN iva_porcentaje TYPE numeric(10,2);

-- presupuestos totals
ALTER TABLE public.presupuestos
  ALTER COLUMN subtotal TYPE numeric(15,2),
  ALTER COLUMN iva TYPE numeric(15,2),
  ALTER COLUMN total TYPE numeric(15,2),
  ALTER COLUMN markup_general TYPE numeric(10,2);

-- ordenes_compra
ALTER TABLE public.ordenes_compra
  ALTER COLUMN subtotal TYPE numeric(15,2),
  ALTER COLUMN iva TYPE numeric(15,2),
  ALTER COLUMN total TYPE numeric(15,2);

-- orden_compra_items
ALTER TABLE public.orden_compra_items
  ALTER COLUMN precio_unitario TYPE numeric(15,2);

-- facturas
ALTER TABLE public.facturas
  ALTER COLUMN subtotal TYPE numeric(15,2),
  ALTER COLUMN iva TYPE numeric(15,2),
  ALTER COLUMN total TYPE numeric(15,2);

-- factura_items
ALTER TABLE public.factura_items
  ALTER COLUMN precio_unitario TYPE numeric(15,2);

-- facturas_compra
ALTER TABLE public.facturas_compra
  ALTER COLUMN subtotal TYPE numeric(15,2),
  ALTER COLUMN iva TYPE numeric(15,2),
  ALTER COLUMN total TYPE numeric(15,2);
