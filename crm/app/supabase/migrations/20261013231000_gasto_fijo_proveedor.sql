-- Gasto fijo atado al proveedor (para avisar si falta la factura del mes). Solo agrega una columna vacía.
begin;
alter table public.gastos_fijos add column if not exists proveedor_id uuid references public.proveedores(id) on delete set null;
create index if not exists gastos_fijos_proveedor_idx on public.gastos_fijos(proveedor_id);
commit;
