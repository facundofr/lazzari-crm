-- Conserva el precio de venta exacto ingresado por el usuario y distingue
-- mercaderia que sale de stock propio para no generar una orden de compra.

alter table public.presupuesto_items
  add column if not exists stock_propio boolean not null default false;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'presupuesto_items'
      and column_name = 'precio_venta' and is_generated = 'ALWAYS'
  ) then
    alter table public.presupuesto_items alter column precio_venta drop expression;
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'presupuesto_items'
      and column_name = 'subtotal' and is_generated = 'ALWAYS'
  ) then
    alter table public.presupuesto_items alter column subtotal drop expression;
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'presupuesto_items'
      and column_name = 'iva' and is_generated = 'ALWAYS'
  ) then
    alter table public.presupuesto_items alter column iva drop expression;
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'presupuesto_items'
      and column_name = 'total' and is_generated = 'ALWAYS'
  ) then
    alter table public.presupuesto_items alter column total drop expression;
  end if;
end $$;

create or replace function public.calcular_totales_presupuesto_item()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.precio_venta is null then
    new.precio_venta := coalesce(new.precio_costo, 0)
      * (1 + coalesce(new.markup_porcentaje, 0) / 100);
  end if;

  new.subtotal := round(coalesce(new.cantidad, 0) * new.precio_venta, 2);
  new.iva := round(new.subtotal * coalesce(new.iva_porcentaje, 0) / 100, 2);
  new.total := new.subtotal + new.iva;
  return new;
end;
$$;

drop trigger if exists calcular_totales_presupuesto_item on public.presupuesto_items;
create trigger calcular_totales_presupuesto_item
before insert or update of cantidad, precio_costo, markup_porcentaje, precio_venta, iva_porcentaje
on public.presupuesto_items
for each row execute function public.calcular_totales_presupuesto_item();

comment on column public.presupuesto_items.precio_venta is
  'Precio unitario de venta exacto confirmado por el usuario.';
comment on column public.presupuesto_items.stock_propio is
  'Si es true, el item sale de stock propio y no genera orden de compra.';
