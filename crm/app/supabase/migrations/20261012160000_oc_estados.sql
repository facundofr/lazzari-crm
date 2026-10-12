-- Estados de OC al día solos — 12/10/2026, con OK de Augusto ("todo").
--
-- Qué hace:
--   1) "¿Está facturada?" (estado_facturacion) y "¿Está pagada?" (estado_pago) de cada OC se completan SOLOS cada vez que se carga,
--      se paga, se anula o se vincula una factura de compra. Antes nadie los completaba (60 OC facturadas figuraban sin facturar
--      y 61 con todas sus facturas pagadas figuraban "pago pendiente").
--        - Facturada: si la OC tiene conciliación por renglón, por cantidades (igual que guardar_conciliacion_compra);
--          si no, por importe (facturas ≥ 99 % del total de la OC) o factura compartida con otras OC → facturada; si no, parcial.
--        - Pagada: todas sus facturas pagadas y la OC facturada completa (o con saldo cerrado). Queda medio_pago = 'facturas' y
--          pagada_at = fecha de la última OP. Si después se anula el pago, vuelve sola a "pendiente".
--        - Las pagadas a mano (tarjeta) y las canceladas no se tocan.
--      Corrige todas las OC de hoy (respaldo de los 4 datos en lz_backup_oc_estados_20261012).
--   2) Una OC cancelada ya no "revive" si se le registra una recepción (auto_estado_oc).
--   3) OC-2026-1130, 1134 y 1173 decían "recibida" con 0 unidades recibidas: se marcan recibidas completas
--      (son pedidos de PR, sin producto de stock: no mueven stock). Respaldo en lz_backup_oc_items_recibido_20261012.
--   4) OC-2026-1104 y 1199: ajuste de 3 centavos de IVA al redondeo por renglón (respaldo en lz_backup_oc_iva_20261012).
--
-- Aditiva: no borra datos. Agrega 2 funciones, 2 disparadores y 2 tablas de respaldo; reescribe auto_estado_oc.
-- Vuelta atrás: supabase/rollback/20261012160000_oc_estados.sql
begin;

-- 1) Factura y pago de la OC al día ---------------------------------------------------------------
create or replace function public.lz_actualizar_fact_pago_oc(p_orden_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_oc record;
  v_n integer;
  v_pagadas integer;
  v_facturado numeric;
  v_compartida boolean;
  v_tiene_asig boolean;
  v_fact text;
  v_fecha_pago date;
begin
  select id, estado, total, estado_pago, medio_pago, pagada_at, saldo_cerrado, estado_facturacion
  into v_oc
  from ordenes_compra
  where id = p_orden_id;

  if not found or v_oc.estado = 'cancelada' then
    return;
  end if;

  -- Facturas de la OC (sin anuladas ni notas de crédito), por vínculo nuevo o columna vieja.
  select count(*),
         count(*) filter (where f.estado = 'pagada'),
         coalesce(sum(f.total), 0),
         coalesce(bool_or(exists (select 1 from factura_compra_ocs l2
                                  where l2.factura_compra_id = f.id and l2.orden_compra_id <> p_orden_id)), false)
  into v_n, v_pagadas, v_facturado, v_compartida
  from facturas_compra f
  where f.estado <> 'anulada'
    and coalesce(f.tipo_comprobante, '') !~* '^NC'
    and (f.orden_compra_id = p_orden_id
         or exists (select 1 from factura_compra_ocs l where l.factura_compra_id = f.id and l.orden_compra_id = p_orden_id));

  select exists (
    select 1 from factura_compra_asignaciones a
    join facturas_compra fa on fa.id = a.factura_compra_id
    where a.orden_compra_id = p_orden_id and fa.estado <> 'anulada'
  ) into v_tiene_asig;

  if v_tiene_asig then
    select case
             when sum(i.cantidad - coalesce(a.asignada, 0)) <= 0.0001 then 'facturada'
             when sum(coalesce(a.asignada, 0)) > 0 then 'parcial'
             else null
           end
    into v_fact
    from orden_compra_items i
    left join (
      select x.orden_compra_item_id, sum(x.cantidad) as asignada
      from factura_compra_asignaciones x
      where not exists (select 1 from facturas_compra fa where fa.id = x.factura_compra_id and fa.estado = 'anulada')
      group by x.orden_compra_item_id
    ) a on a.orden_compra_item_id = i.id
    where i.orden_id = p_orden_id;
  elsif v_n = 0 then
    v_fact := null;
  elsif v_compartida or v_facturado >= coalesce(v_oc.total, 0) * 0.99 then
    v_fact := 'facturada';
  else
    v_fact := 'parcial';
  end if;

  update ordenes_compra
  set estado_facturacion = v_fact
  where id = p_orden_id
    and estado_facturacion is distinct from v_fact;

  -- Pagada a mano (tarjeta u otro medio cargado en la OC): no se toca.
  if v_oc.estado_pago = 'pagada' and v_oc.medio_pago is distinct from 'facturas' then
    return;
  end if;

  if v_n > 0 and v_pagadas = v_n and (v_fact = 'facturada' or coalesce(v_oc.saldo_cerrado, false)) then
    select max(op.fecha)
    into v_fecha_pago
    from op_facturas_compra ofc
    join ordenes_pago op on op.id = ofc.orden_pago_id
    where op.estado <> 'anulada'
      and ofc.factura_compra_id in (
        select f.id from facturas_compra f
        where f.orden_compra_id = p_orden_id
           or exists (select 1 from factura_compra_ocs l where l.factura_compra_id = f.id and l.orden_compra_id = p_orden_id)
      );

    update ordenes_compra
    set estado_pago = 'pagada',
        medio_pago = 'facturas',
        pagada_at = coalesce(case when v_oc.medio_pago = 'facturas' then v_oc.pagada_at end,
                             (v_fecha_pago::timestamp + time '12:00') at time zone 'America/Argentina/Buenos_Aires',
                             now())
    where id = p_orden_id
      and (estado_pago is distinct from 'pagada' or medio_pago is distinct from 'facturas');
  elsif v_oc.estado_pago = 'pagada' and v_oc.medio_pago = 'facturas' then
    update ordenes_compra
    set estado_pago = 'pendiente', medio_pago = null, pagada_at = null
    where id = p_orden_id;
  end if;
end;
$$;

revoke all on function public.lz_actualizar_fact_pago_oc(uuid) from public, anon, authenticated;

create or replace function public.lz_trg_fact_pago_oc()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_oc uuid;
begin
  if TG_TABLE_NAME = 'facturas_compra' then
    for v_oc in
      select distinct x from unnest(array[
        case when TG_OP <> 'INSERT' then OLD.orden_compra_id end,
        case when TG_OP <> 'DELETE' then NEW.orden_compra_id end
      ]) x where x is not null
      union
      select l.orden_compra_id from factura_compra_ocs l
      where l.factura_compra_id = coalesce(NEW.id, OLD.id)
    loop
      perform lz_actualizar_fact_pago_oc(v_oc);
    end loop;
  else
    for v_oc in
      select distinct x from unnest(array[
        case when TG_OP <> 'INSERT' then OLD.orden_compra_id end,
        case when TG_OP <> 'DELETE' then NEW.orden_compra_id end
      ]) x where x is not null
    loop
      perform lz_actualizar_fact_pago_oc(v_oc);
    end loop;
  end if;
  return coalesce(NEW, OLD);
end;
$$;

drop trigger if exists lz_fact_pago_oc on public.facturas_compra;
create trigger lz_fact_pago_oc
  after insert or delete or update of estado, total, tipo_comprobante, orden_compra_id on public.facturas_compra
  for each row execute function public.lz_trg_fact_pago_oc();

drop trigger if exists lz_fact_pago_oc on public.factura_compra_ocs;
create trigger lz_fact_pago_oc
  after insert or delete or update on public.factura_compra_ocs
  for each row execute function public.lz_trg_fact_pago_oc();

-- Respaldo y corrección de todas las OC de hoy.
create table if not exists public.lz_backup_oc_estados_20261012 (
  id uuid primary key,
  numero text,
  estado_facturacion text,
  estado_pago text,
  medio_pago text,
  pagada_at timestamptz,
  guardado_at timestamptz default now()
);
alter table public.lz_backup_oc_estados_20261012 enable row level security;

insert into public.lz_backup_oc_estados_20261012 (id, numero, estado_facturacion, estado_pago, medio_pago, pagada_at)
select id, numero, estado_facturacion, estado_pago, medio_pago, pagada_at
from public.ordenes_compra
on conflict (id) do nothing;

select public.lz_actualizar_fact_pago_oc(id) from public.ordenes_compra;

-- 2) Una OC cancelada no revive con una recepción ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.auto_estado_oc()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_total_items integer;
  v_items_completos integer;
  v_items_parciales integer;
BEGIN
  IF EXISTS (SELECT 1 FROM public.ordenes_compra WHERE id = NEW.orden_id AND estado = 'cancelada') THEN
    RETURN NEW;
  END IF;

  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE cantidad_recibida >= cantidad),
    COUNT(*) FILTER (WHERE cantidad_recibida > 0 AND cantidad_recibida < cantidad)
  INTO v_total_items, v_items_completos, v_items_parciales
  FROM public.orden_compra_items
  WHERE orden_id = NEW.orden_id;

  IF v_items_completos = v_total_items THEN
    UPDATE public.ordenes_compra SET estado = 'recibida' WHERE id = NEW.orden_id;
  ELSIF v_items_completos > 0 OR v_items_parciales > 0 THEN
    UPDATE public.ordenes_compra SET estado = 'recibida_parcial' WHERE id = NEW.orden_id;
  END IF;

  RETURN NEW;
END;
$function$;

-- 3) OC "recibida" con 0 unidades: recibidas completas ----------------------------------------------
create table if not exists public.lz_backup_oc_items_recibido_20261012 (
  id uuid primary key,
  orden_id uuid,
  cantidad_recibida numeric,
  guardado_at timestamptz default now()
);
alter table public.lz_backup_oc_items_recibido_20261012 enable row level security;

insert into public.lz_backup_oc_items_recibido_20261012 (id, orden_id, cantidad_recibida)
select i.id, i.orden_id, i.cantidad_recibida
from public.orden_compra_items i
join public.ordenes_compra oc on oc.id = i.orden_id
where oc.numero in ('OC-2026-1130', 'OC-2026-1134', 'OC-2026-1173')
  and oc.sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021'
on conflict (id) do nothing;

update public.orden_compra_items i
set cantidad_recibida = i.cantidad
from public.ordenes_compra oc
where oc.id = i.orden_id
  and oc.numero in ('OC-2026-1130', 'OC-2026-1134', 'OC-2026-1173')
  and oc.sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021'
  and oc.estado = 'recibida'
  and i.cantidad_recibida < i.cantidad;

-- 4) 3 centavos de IVA (OC-2026-1104 y 1199) ---------------------------------------------------------
insert into public.lz_backup_oc_iva_20261012 (id, numero, subtotal, iva, total)
select id, numero, subtotal, iva, total
from public.ordenes_compra
where numero in ('OC-2026-1104', 'OC-2026-1199')
  and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021'
on conflict (id) do nothing;

select public.lz_recalcular_totales_oc(id)
from public.ordenes_compra
where numero in ('OC-2026-1104', 'OC-2026-1199')
  and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021';

commit;
