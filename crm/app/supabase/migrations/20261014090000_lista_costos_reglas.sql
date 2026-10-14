-- Lista de costos dentro del CRM — etapa 1: reglas comerciales por proveedor, descuentos opcionales,
-- márgenes de venta, historial de cargas y fotos de artículos.
-- Cambio ADITIVO: tablas y columnas nuevas. No modifica costos ni precios (siguen saliendo de catalogo_crm.csv).
-- Fuente de las reglas: Base_de_Costos_Lazzari_Oct2026.xlsx (hoja "Reglas"), cargadas con scripts/importar-reglas-costos.cjs.
-- Vuelta atrás: supabase/rollback/20261014090000_lista_costos_reglas.sql

-- 1) Reglas por proveedor de la lista (proveedor_lista = nombre en catalogo_costos.proveedor, p. ej. "Startex").
create table if not exists public.proveedor_reglas (
  id uuid primary key default gen_random_uuid(),
  proveedor_lista text not null unique,
  moneda text,
  vigencia_texto text,
  vigencia_hasta date,
  desc1 numeric,
  desc2 numeric,
  en_cascada boolean not null default true,
  como_se_calcula text,
  condiciones text,
  actualizado_at timestamptz not null default now(),
  actualizado_por uuid references public.profiles(id)
);
comment on table public.proveedor_reglas is 'Reglas comerciales por proveedor de la lista de costos (hoja Reglas del Excel). Los descuentos son sobre el precio de lista, en cascada.';

-- 2) Descuentos opcionales/condicionales: NO entran en el costo, son margen extra de cada operación.
--    tipo: pago_anticipado (Augusto: "contado" = pagar antes por transferencia, es lo mismo) | cantidad | volumen_mensual | excepcional
create table if not exists public.proveedor_descuentos_opcionales (
  id uuid primary key default gen_random_uuid(),
  proveedor_lista text not null,
  tipo text not null check (tipo in ('pago_anticipado', 'cantidad', 'volumen_mensual', 'excepcional')),
  porcentaje numeric not null check (porcentaje > 0 and porcentaje < 100),
  monto_minimo numeric,
  moneda_minimo text,
  condicion text,
  requiere_autorizacion boolean not null default false,
  activo boolean not null default true,
  actualizado_at timestamptz not null default now(),
  unique (proveedor_lista, tipo)
);
comment on table public.proveedor_descuentos_opcionales is 'Descuentos opcionales por proveedor. No se incluyen en el costo. El de pago anticipado se mantiene sincronizado con proveedores.descuento_pronto_pago.';

-- 3) Márgenes de venta por rubro/marca (tabla 4 de la hoja Reglas) y configuración (redondeo).
create table if not exists public.margenes_venta (
  id uuid primary key default gen_random_uuid(),
  orden integer not null default 0,
  rubro text not null unique,
  margen numeric not null check (margen >= 0 and margen < 10),
  aplica_a text,
  actualizado_at timestamptz not null default now()
);
create table if not exists public.lista_costos_config (
  clave text primary key,
  valor jsonb not null,
  actualizado_at timestamptz not null default now()
);

-- 4) Historial de cargas (quién, cuándo, qué archivo y qué cambió).
create table if not exists public.catalogo_cargas (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('reglas', 'fotos', 'catalogo', 'opcionales')),
  archivo text,
  resumen jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

-- 5) Foto de cada artículo (ruta dentro del bucket "productos").
alter table public.catalogo_costos add column if not exists foto_path text;

-- 6) Bucket de fotos de productos (lectura pública: son fotos de catálogo, sin precios).
insert into storage.buckets (id, name, public)
values ('productos', 'productos', true)
on conflict (id) do nothing;

-- 7) Permisos: leen los mismos roles que la lista de costos; escriben admin y super_admin.
alter table public.proveedor_reglas enable row level security;
alter table public.proveedor_descuentos_opcionales enable row level security;
alter table public.margenes_venta enable row level security;
alter table public.lista_costos_config enable row level security;
alter table public.catalogo_cargas enable row level security;

do $$
declare t text;
begin
  foreach t in array array['proveedor_reglas', 'proveedor_descuentos_opcionales', 'margenes_venta', 'lista_costos_config', 'catalogo_cargas'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.get_my_role() = any (array[''super_admin'',''admin'',''administrativo'',''vendedor'']::public.user_role[]))', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.get_my_role() = any (array[''super_admin'',''admin'']::public.user_role[])) with check (public.get_my_role() = any (array[''super_admin'',''admin'']::public.user_role[]))', t || '_write', t);
  end loop;
end $$;

-- 8) Un solo dato para el descuento por pago anticipado:
--    proveedor_descuentos_opcionales (tipo pago_anticipado)  <->  proveedores.descuento_pronto_pago
--    (de todos los proveedores del CRM vinculados a ese nombre de lista, en las dos sociedades).
create or replace function public.sync_anticipado_a_proveedores()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_lista text; v_pct numeric;
begin
  if pg_trigger_depth() > 1 then return null; end if;
  v_lista := coalesce(new.proveedor_lista, old.proveedor_lista);
  if coalesce(new.tipo, old.tipo) <> 'pago_anticipado' then return null; end if;
  v_pct := case when tg_op = 'DELETE' or not new.activo then null else new.porcentaje end;
  update public.proveedores p set descuento_pronto_pago = v_pct
   where p.id in (select cp.proveedor_id from public.catalogo_proveedores cp where cp.proveedor_lista = v_lista)
     and p.descuento_pronto_pago is distinct from v_pct;
  return null;
end $$;

drop trigger if exists trg_sync_anticipado_a_proveedores on public.proveedor_descuentos_opcionales;
create trigger trg_sync_anticipado_a_proveedores
after insert or update or delete on public.proveedor_descuentos_opcionales
for each row execute function public.sync_anticipado_a_proveedores();

create or replace function public.sync_anticipado_desde_proveedor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_lista text;
begin
  if pg_trigger_depth() > 1 then return null; end if;
  if new.descuento_pronto_pago is not distinct from old.descuento_pronto_pago then return null; end if;
  for v_lista in select distinct cp.proveedor_lista from public.catalogo_proveedores cp where cp.proveedor_id = new.id loop
    if new.descuento_pronto_pago is null or new.descuento_pronto_pago <= 0 then
      update public.proveedor_descuentos_opcionales set activo = false, actualizado_at = now()
       where proveedor_lista = v_lista and tipo = 'pago_anticipado';
    else
      insert into public.proveedor_descuentos_opcionales (proveedor_lista, tipo, porcentaje, activo)
      values (v_lista, 'pago_anticipado', new.descuento_pronto_pago, true)
      on conflict (proveedor_lista, tipo) do update set porcentaje = excluded.porcentaje, activo = true, actualizado_at = now();
    end if;
    -- La otra sociedad queda con el mismo valor.
    update public.proveedores p set descuento_pronto_pago = new.descuento_pronto_pago
     where p.id <> new.id
       and p.id in (select cp2.proveedor_id from public.catalogo_proveedores cp2 where cp2.proveedor_lista = v_lista)
       and p.descuento_pronto_pago is distinct from new.descuento_pronto_pago;
  end loop;
  return null;
end $$;

drop trigger if exists trg_sync_anticipado_desde_proveedor on public.proveedores;
create trigger trg_sync_anticipado_desde_proveedor
after update of descuento_pronto_pago on public.proveedores
for each row execute function public.sync_anticipado_desde_proveedor();

notify pgrst, 'reload schema';
