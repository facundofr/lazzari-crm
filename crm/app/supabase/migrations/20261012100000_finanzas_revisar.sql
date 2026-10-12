-- Finanzas > Hoy > Revisar: cosas con dudas que quedan anotadas para resolver después
-- (fecha de recepción de un cheque, diferencia de un cobro, ¿factura duplicada?, línea del extracto, etc.).
--
-- Una sola tabla nueva. No toca ninguna tabla existente. No se borran filas: se marcan "resuelto".
-- Vuelta atrás: supabase/rollback/20261012100000_finanzas_revisar.sql
begin;

create table if not exists public.finanzas_revisar (
  id uuid primary key default gen_random_uuid(),
  sociedad_id uuid not null references public.sociedades(id) on delete restrict,
  -- Qué cosa es y su id (para el botón "Abrir"). "otro" = nota suelta sin registro asociado.
  entidad_tipo text not null default 'otro' check (entidad_tipo in (
    'cheque', 'movimiento', 'factura_venta', 'factura_compra', 'orden_pago', 'extracto', 'cliente', 'proveedor', 'otro'
  )),
  entidad_id uuid,
  -- Texto corto que identifica la cosa ("eCheq 3968 Del Sol", "FA 15-54").
  titulo text not null,
  motivo text not null default 'otro',
  nota text,
  importe numeric(16, 2),
  moneda text not null default 'ARS' check (moneda in ('ARS', 'USD')),
  cliente_id uuid references public.clientes(id) on delete set null,
  proveedor_id uuid references public.proveedores(id) on delete set null,
  -- Si tiene fecha, ese día avisa la campana.
  recordar_el date,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'resuelto')),
  resolucion text,
  resuelto_at timestamptz,
  resuelto_por uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null default auth.uid()
);

create index if not exists finanzas_revisar_pendientes_idx
  on public.finanzas_revisar(sociedad_id, created_at desc) where estado = 'pendiente';
create index if not exists finanzas_revisar_entidad_idx
  on public.finanzas_revisar(entidad_tipo, entidad_id) where entidad_id is not null;
create index if not exists finanzas_revisar_recordar_idx
  on public.finanzas_revisar(recordar_el) where estado = 'pendiente' and recordar_el is not null;

comment on table public.finanzas_revisar is 'Finanzas > Hoy > Revisar: dudas anotadas para resolver después. No se borran: se marcan resueltas.';
comment on column public.finanzas_revisar.motivo is 'diferencia_cobro, fecha_recepcion, fecha_futura, posible_duplicado, retenciones, falta_cargar, otro (texto libre permitido).';

alter table public.finanzas_revisar enable row level security;
revoke all on public.finanzas_revisar from anon, authenticated;
-- Sin DELETE a propósito: lo resuelto queda como historia.
grant select, insert, update on public.finanzas_revisar to authenticated;
drop policy if exists finanzas_revisar_rw on public.finanzas_revisar;
create policy finanzas_revisar_rw on public.finanzas_revisar
  for all to authenticated
  using (public.lz_puede_operar_finanzas(sociedad_id))
  with check (public.lz_puede_operar_finanzas(sociedad_id));

commit;
