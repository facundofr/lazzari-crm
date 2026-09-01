-- En un PR manual, precio_venta ya es el precio final que ve el cliente.
-- Conservamos iva_porcentaje para los procesos internos posteriores, pero no
-- volvemos a sumar ese IVA en los importes visibles del presupuesto.

create or replace function public.calcular_totales_presupuesto_item()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_es_manual boolean := false;
begin
  if new.precio_venta is null then
    new.precio_venta := coalesce(new.precio_costo, 0)
      * (1 + coalesce(new.markup_porcentaje, 0) / 100);
  end if;

  select coalesce(p.modalidad_emision = 'manual', false)
    into v_es_manual
  from public.presupuestos p
  where p.id = new.presupuesto_id;

  new.subtotal := round(coalesce(new.cantidad, 0) * new.precio_venta, 2);

  if v_es_manual then
    new.iva := 0;
    new.total := new.subtotal;
  else
    new.iva := round(new.subtotal * coalesce(new.iva_porcentaje, 0) / 100, 2);
    new.total := new.subtotal + new.iva;
  end if;

  return new;
end;
$$;

-- Reprocesa los PR manuales existentes (incluido PR-2026-1033) con la regla
-- corregida. El trigger de agregado también recalcula sus encabezados.
update public.presupuesto_items pi
set precio_venta = pi.precio_venta
from public.presupuestos p
where p.id = pi.presupuesto_id
  and p.modalidad_emision = 'manual';

-- Deja el encabezado explícitamente consistente aun si un PR no tiene items.
update public.presupuestos p
set subtotal = coalesce(t.subtotal, 0),
    iva = 0,
    total = coalesce(t.subtotal, 0)
from (
  select p2.id,
         round(coalesce(sum(pi.subtotal), 0), 2) as subtotal
  from public.presupuestos p2
  left join public.presupuesto_items pi on pi.presupuesto_id = p2.id
  where p2.modalidad_emision = 'manual'
  group by p2.id
) t
where p.id = t.id;

-- La migración no se considera aplicada si queda un PR manual con IVA sumado.
do $$
begin
  if exists (
    select 1
    from public.presupuesto_items pi
    join public.presupuestos p on p.id = pi.presupuesto_id
    where p.modalidad_emision = 'manual'
      and (coalesce(pi.iva, 0) <> 0 or pi.total <> pi.subtotal)
  ) then
    raise exception 'Quedaron items de PR manual con IVA sumado al precio final';
  end if;

  if exists (
    select 1
    from public.presupuestos p
    where p.modalidad_emision = 'manual'
      and (coalesce(p.iva, 0) <> 0 or p.total <> p.subtotal)
  ) then
    raise exception 'Quedaron PR manuales con IVA sumado al total';
  end if;
end;
$$;
