alter table public.facturas_compra_items
  add column if not exists descuento_porcentaje numeric(7, 4) not null default 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.facturas_compra_items'::regclass
      and conname = 'facturas_compra_items_descuento_porcentaje_check'
  ) then
    alter table public.facturas_compra_items
      add constraint facturas_compra_items_descuento_porcentaje_check
      check (descuento_porcentaje >= 0 and descuento_porcentaje <= 100);
  end if;
end
$$;

comment on column public.facturas_compra_items.descuento_porcentaje is
  'Descuento aplicado al precio unitario antes de calcular IVA.';
