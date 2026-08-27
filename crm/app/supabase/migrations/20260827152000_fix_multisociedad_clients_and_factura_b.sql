-- El mismo CUIT puede operar como cliente de más de una sociedad.
-- Dentro de una misma sociedad sigue siendo único.
drop index if exists public.clientes_cuit_unique;

create unique index if not exists clientes_sociedad_cuit_unique
on public.clientes (sociedad_id, cuit)
where sociedad_id is not null and cuit is not null and cuit <> '';

-- Factura A: el precio unitario es neto y el IVA se suma.
-- Factura B: el precio unitario ya es final y el IVA se obtiene desde ese total.
create or replace function public.recalcular_factura()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_factura_id uuid;
  v_es_precio_final boolean;
begin
  v_factura_id := coalesce(new.factura_id, old.factura_id);

  select tipo in ('FB', 'FCEB', 'NCB', 'NDB', 'NCEB', 'X')
  into v_es_precio_final
  from public.facturas
  where id = v_factura_id;

  update public.facturas
  set
    subtotal = totals.subtotal,
    iva = totals.iva,
    total = totals.total
  from (
    select
      round(coalesce(sum(
        case when v_es_precio_final
          then cantidad * precio_unitario / (1 + iva_porcentaje / 100)
          else cantidad * precio_unitario
        end
      ), 0), 2) as subtotal,
      round(coalesce(sum(
        case when v_es_precio_final
          then cantidad * precio_unitario - (cantidad * precio_unitario / (1 + iva_porcentaje / 100))
          else cantidad * precio_unitario * iva_porcentaje / 100
        end
      ), 0), 2) as iva,
      round(coalesce(sum(
        case when v_es_precio_final
          then cantidad * precio_unitario
          else cantidad * precio_unitario * (1 + iva_porcentaje / 100)
        end
      ), 0), 2) as total
    from public.factura_items
    where factura_id = v_factura_id
  ) totals
  where id = v_factura_id;

  return coalesce(new, old);
end;
$$;

-- Repara únicamente comprobantes B manuales ya guardados. No modifica
-- comprobantes electrónicos autorizados por ARCA.
update public.facturas f
set
  subtotal = totals.subtotal,
  iva = totals.iva,
  total = totals.total
from (
  select
    fi.factura_id,
    round(sum(fi.cantidad * fi.precio_unitario / (1 + fi.iva_porcentaje / 100)), 2) as subtotal,
    round(sum(fi.cantidad * fi.precio_unitario - (fi.cantidad * fi.precio_unitario / (1 + fi.iva_porcentaje / 100))), 2) as iva,
    round(sum(fi.cantidad * fi.precio_unitario), 2) as total
  from public.factura_items fi
  group by fi.factura_id
) totals
where f.id = totals.factura_id
  and f.cae is null
  and f.tipo in ('FB', 'FCEB', 'NCB', 'NDB', 'NCEB', 'X');
