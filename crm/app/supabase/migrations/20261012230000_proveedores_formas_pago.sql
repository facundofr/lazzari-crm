-- Cómo se le paga a cada proveedor — 12/10/2026, OK de Augusto ("Va 1 a 7"; días desde la fecha de factura; hay pronto pago).
--
-- 1) proveedores: nombre de la persona de administración; condición de pago (anticipado / contra entrega / cuenta corriente N días /
--    escalonado de N a M días), medios aceptados + preferido, plazo del cheque y % de descuento por pago anticipado.
--    La forma_pago / dias_cuenta_corriente viejos quedan como estaban (no se borran).
-- 2) ordenes_compra y facturas_compra: copia de la condición de pago que pidió el proveedor en esa compra (el comprador la indica
--    si el proveedor es nuevo). La factura calcula su vencimiento desde la fecha de factura.
-- 3) cheque_fechas_mes: las 3 fechas de cheque de cada mes (idea interna: centralizar los cheques en 3 días por mes).
-- 4) Datos que pasó Augusto: Prisina y TKW escalonado 30 a 75 días; Segutécnica 60 días; Star-Tex 5 % por pago anticipado;
--    DPS (Industrias De Pascale) anticipado con 5 % de descuento. Medios: se pasan los de la forma de pago vieja.
-- Aditiva: no borra nada. Vuelta atrás: supabase/rollback/20261012230000_proveedores_formas_pago.sql
begin;

-- 1) Proveedores ---------------------------------------------------------------------------------------------
alter table public.proveedores
  add column if not exists administracion_nombre text,
  add column if not exists condicion_pago text check (condicion_pago in ('anticipado', 'contra_entrega', 'cuenta_corriente', 'escalonado')),
  add column if not exists dias_pago integer check (dias_pago between 0 and 365),
  add column if not exists dias_pago_hasta integer check (dias_pago_hasta between 0 and 365),
  add column if not exists medios_pago text[] not null default '{}',
  add column if not exists medio_pago_preferido text check (medio_pago_preferido in ('transferencia', 'echeq', 'cheque', 'tarjeta', 'efectivo')),
  add column if not exists plazo_cheque_dias integer check (plazo_cheque_dias between 0 and 365),
  add column if not exists descuento_pronto_pago numeric(5, 2) check (descuento_pronto_pago between 0 and 100);

comment on column public.proveedores.condicion_pago is 'anticipado | contra_entrega | cuenta_corriente (dias_pago) | escalonado (dias_pago a dias_pago_hasta). Días desde la fecha de factura.';
comment on column public.proveedores.medios_pago is 'Medios que acepta: transferencia, echeq, cheque, tarjeta, efectivo.';
comment on column public.proveedores.descuento_pronto_pago is '% de descuento si se paga anticipado (ej. Star-Tex 5).';

-- 2) Compras -----------------------------------------------------------------------------------------------
alter table public.ordenes_compra
  add column if not exists condicion_pago text check (condicion_pago in ('anticipado', 'contra_entrega', 'cuenta_corriente', 'escalonado')),
  add column if not exists dias_pago integer check (dias_pago between 0 and 365),
  add column if not exists dias_pago_hasta integer check (dias_pago_hasta between 0 and 365),
  add column if not exists medio_pago_preferido text check (medio_pago_preferido in ('transferencia', 'echeq', 'cheque', 'tarjeta', 'efectivo')),
  add column if not exists plazo_cheque_dias integer check (plazo_cheque_dias between 0 and 365),
  add column if not exists descuento_pronto_pago numeric(5, 2) check (descuento_pronto_pago between 0 and 100);

alter table public.facturas_compra
  add column if not exists condicion_pago text check (condicion_pago in ('anticipado', 'contra_entrega', 'cuenta_corriente', 'escalonado')),
  add column if not exists dias_pago integer check (dias_pago between 0 and 365),
  add column if not exists dias_pago_hasta integer check (dias_pago_hasta between 0 and 365);

-- 3) Fechas de cheque por mes -----------------------------------------------------------------------------
create table if not exists public.cheque_fechas_mes (
  id uuid primary key default gen_random_uuid(),
  sociedad_id uuid not null references public.sociedades(id) on delete restrict,
  mes date not null check (extract(day from mes) = 1),
  dias integer[] not null check (cardinality(dias) between 1 and 6),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  unique (sociedad_id, mes)
);
comment on table public.cheque_fechas_mes is 'Días del mes en que se centralizan los cheques que emitimos (ej. octubre: 12, 21, 31).';

alter table public.cheque_fechas_mes enable row level security;
revoke all on public.cheque_fechas_mes from anon, authenticated;
grant select, insert, update on public.cheque_fechas_mes to authenticated;
drop policy if exists cheque_fechas_mes_select on public.cheque_fechas_mes;
create policy cheque_fechas_mes_select on public.cheque_fechas_mes
  for select to authenticated using (public.lz_es_de_sociedad(sociedad_id));
drop policy if exists cheque_fechas_mes_write on public.cheque_fechas_mes;
create policy cheque_fechas_mes_write on public.cheque_fechas_mes
  for all to authenticated
  using (public.lz_puede_operar_finanzas(sociedad_id))
  with check (public.lz_puede_operar_finanzas(sociedad_id));

insert into public.cheque_fechas_mes (sociedad_id, mes, dias)
select s.id, x.mes, x.dias
from public.sociedades s
cross join (values ('2026-10-01'::date, array[12, 21, 31]), ('2026-11-01'::date, array[11, 21, 30]), ('2026-12-01'::date, array[11, 20, 30])) as x(mes, dias)
where s.id in ('eee2a3c8-fe6c-494d-bd2f-7a5d8067d021', 'fee94607-747a-4e87-ba24-aff9032f7a56')
on conflict (sociedad_id, mes) do nothing;

-- 4) Datos conocidos --------------------------------------------------------------------------------------
-- Medios desde la forma de pago vieja (solo si todavía no tiene medios cargados).
update public.proveedores set
  medios_pago = array[case lower(trim(forma_pago))
    when 'transferencia' then 'transferencia' when 'echeq' then 'echeq' when 'cheque' then 'cheque'
    when 'tarjeta' then 'tarjeta' when 'efectivo' then 'efectivo' end],
  medio_pago_preferido = case lower(trim(forma_pago))
    when 'transferencia' then 'transferencia' when 'echeq' then 'echeq' when 'cheque' then 'cheque'
    when 'tarjeta' then 'tarjeta' when 'efectivo' then 'efectivo' end
where cardinality(medios_pago) = 0
  and lower(trim(coalesce(forma_pago, ''))) in ('transferencia', 'echeq', 'cheque', 'tarjeta', 'efectivo');

-- Prisina y TKW: escalonado de 30 a 75 días con eCheq.
update public.proveedores set condicion_pago = 'escalonado', dias_pago = 30, dias_pago_hasta = 75,
  medios_pago = (select array(select distinct unnest(medios_pago || array['echeq']))), medio_pago_preferido = 'echeq'
where regexp_replace(coalesce(cuit, ''), '\D', '', 'g') in ('30709905402', '30713315202');

-- Segutécnica: cuenta corriente 60 días.
update public.proveedores set condicion_pago = 'cuenta_corriente', dias_pago = 60, dias_pago_hasta = null
where regexp_replace(coalesce(cuit, ''), '\D', '', 'g') = '33629040019';

-- Star-Tex: 5 % si se paga anticipado.
update public.proveedores set descuento_pronto_pago = 5
where regexp_replace(coalesce(cuit, ''), '\D', '', 'g') = '30608543844';

-- DPS (Industrias De Pascale): anticipado, 5 % de descuento.
update public.proveedores set condicion_pago = 'anticipado', dias_pago = 0, dias_pago_hasta = null, descuento_pronto_pago = 5
where regexp_replace(coalesce(cuit, ''), '\D', '', 'g') = '30707784292';

commit;
