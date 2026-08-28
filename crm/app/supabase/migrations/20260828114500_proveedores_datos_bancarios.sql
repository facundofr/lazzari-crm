-- Datos bancarios opcionales para pagos a proveedores.

alter table public.proveedores
  add column if not exists cbu text,
  add column if not exists alias_bancario text,
  add column if not exists numero_cuenta text;

comment on column public.proveedores.cbu is 'CBU o CVU informado por el proveedor.';
comment on column public.proveedores.alias_bancario is 'Alias bancario informado por el proveedor.';
comment on column public.proveedores.numero_cuenta is 'Numero de cuenta bancaria informado por el proveedor.';
