-- Recalcular OC con el IVA de cada renglón — 12/10/2026, con OK de Augusto (punto 3 de "arreglar lo roto").
--
-- Qué arregla:
--   El disparador recalcular_oc (tabla orden_compra_items) ponía IVA 21 % fijo a toda la OC cada vez que se tocaba
--   un renglón, incluso al registrar la recepción. Rompía las OC de PR manual (van sin IVA) y los renglones al 10,5 % / 0 %.
--   Ahora:
--     1) El IVA se calcula renglón por renglón con su iva_porcentaje (sin dato = 21 %), redondeado a centavos por renglón
--        (igual que la pantalla de OC).
--     2) OC de PR manual → IVA 0, siempre.
--     3) OC que ya estaba sin IVA (IVA 0 con importe) → sigue sin IVA (misma regla que la pantalla: ocCompraSinIva).
--     4) Registrar la recepción (cantidad_recibida) u otros cambios que no tocan importes NO recalculan nada.
--
-- Corrige 10 OC que quedaron mal (todas "recibida"). Se usó la factura del proveedor para confirmar el IVA correcto:
--   PR manual, sin factura:            OC-2026-1160, 1166, 1184, 1194          → IVA 0
--   Factura del proveedor sin IVA:     OC-2026-1112, 1142, 1148                → IVA 0
--   Factura del proveedor al 10,5 %:   OC-2026-1059, 1216                      → IVA por renglón
--   OC-2026-1173: su factura vino al 21 % pero los renglones decían 10,5 % → los renglones pasan a 21 % (el importe ya coincidía con la factura).
--   Antes de cambiar, guarda los importes viejos en lz_backup_oc_iva_20261012 (para la vuelta atrás).
--
-- Aditiva: no borra datos. Agrega una función de ayuda y una tabla de respaldo; reescribe recalcular_oc.
-- Vuelta atrás: supabase/rollback/20261012150000_recalcular_oc_iva.sql
begin;

create or replace function public.lz_recalcular_totales_oc(p_orden_id uuid)
returns void
language plpgsql
as $$
declare
  v_manual boolean;
  v_iva_actual numeric;
  v_sub_actual numeric;
  v_sub numeric;
  v_iva numeric;
begin
  select coalesce(pr.modalidad_emision = 'manual', false), oc.iva, oc.subtotal
  into v_manual, v_iva_actual, v_sub_actual
  from public.ordenes_compra oc
  left join public.presupuestos pr on pr.id = oc.presupuesto_origen_id
  where oc.id = p_orden_id;

  if not found then
    return;
  end if;

  select
    round(coalesce(sum(i.cantidad * i.precio_unitario), 0), 2),
    coalesce(sum(round(i.cantidad * i.precio_unitario * coalesce(i.iva_porcentaje, 21) / 100, 2)), 0)
  into v_sub, v_iva
  from public.orden_compra_items i
  where i.orden_id = p_orden_id;

  if v_manual or (coalesce(v_iva_actual, 0) = 0 and coalesce(v_sub_actual, 0) > 0) then
    v_iva := 0;
  end if;

  update public.ordenes_compra
  set subtotal = v_sub,
      iva = v_iva,
      total = v_sub + v_iva
  where id = p_orden_id
    and (subtotal is distinct from v_sub or iva is distinct from v_iva or total is distinct from v_sub + v_iva);
end;
$$;

CREATE OR REPLACE FUNCTION public.recalcular_oc()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Recepción u otros cambios que no tocan importes: no recalcular.
  IF TG_OP = 'UPDATE'
     AND NEW.orden_id = OLD.orden_id
     AND NEW.cantidad IS NOT DISTINCT FROM OLD.cantidad
     AND NEW.precio_unitario IS NOT DISTINCT FROM OLD.precio_unitario
     AND NEW.iva_porcentaje IS NOT DISTINCT FROM OLD.iva_porcentaje THEN
    RETURN NEW;
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM public.lz_recalcular_totales_oc(OLD.orden_id);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND (TG_OP = 'INSERT' OR NEW.orden_id IS DISTINCT FROM OLD.orden_id) THEN
    PERFORM public.lz_recalcular_totales_oc(NEW.orden_id);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- Respaldo de los importes de las 10 OC antes de corregirlas.
create table if not exists public.lz_backup_oc_iva_20261012 (
  id uuid primary key,
  numero text,
  subtotal numeric,
  iva numeric,
  total numeric,
  guardado_at timestamptz default now()
);
alter table public.lz_backup_oc_iva_20261012 enable row level security;

insert into public.lz_backup_oc_iva_20261012 (id, numero, subtotal, iva, total)
select id, numero, subtotal, iva, total
from public.ordenes_compra
where numero in ('OC-2026-1160', 'OC-2026-1166', 'OC-2026-1184', 'OC-2026-1194',
                 'OC-2026-1112', 'OC-2026-1142', 'OC-2026-1148', 'OC-2026-1059', 'OC-2026-1216', 'OC-2026-1173')
  and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021'
on conflict (id) do nothing;

-- Sin IVA: PR manual y facturas del proveedor sin IVA.
update public.ordenes_compra
set iva = 0, total = subtotal
where numero in ('OC-2026-1160', 'OC-2026-1166', 'OC-2026-1184', 'OC-2026-1194',
                 'OC-2026-1112', 'OC-2026-1142', 'OC-2026-1148')
  and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021';

-- IVA por renglón (10,5 %).
select public.lz_recalcular_totales_oc(id)
from public.ordenes_compra
where numero in ('OC-2026-1059', 'OC-2026-1216')
  and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021';

-- OC-2026-1173: renglones al 21 % como la factura del proveedor (el disparador nuevo recalcula la OC).
update public.orden_compra_items i
set iva_porcentaje = 21
from public.ordenes_compra oc
where i.orden_id = oc.id
  and oc.numero = 'OC-2026-1173'
  and oc.sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021'
  and i.iva_porcentaje = 10.5;

commit;
