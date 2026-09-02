create table if not exists public.muestra_productos (
  id uuid primary key default gen_random_uuid(),
  sociedad_id uuid not null references public.sociedades(id) on delete cascade,
  codigo text not null,
  descripcion text not null,
  talle text,
  color text,
  stock_total integer not null default 0 check (stock_total >= 0),
  activo boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists muestra_productos_sociedad_codigo_idx
  on public.muestra_productos(sociedad_id, lower(codigo));

create table if not exists public.muestra_envios (
  id uuid primary key default gen_random_uuid(),
  sociedad_id uuid not null references public.sociedades(id) on delete cascade,
  numero text not null,
  fecha date not null default current_date,
  cliente_id uuid not null references public.clientes(id) on delete restrict,
  sucursal_id uuid references public.cliente_sucursales(id) on delete set null,
  estado text not null default 'en_cliente'
    check (estado in ('en_cliente', 'parcial', 'devuelto')),
  observaciones text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sociedad_id, numero)
);

create index if not exists muestra_envios_sociedad_fecha_idx
  on public.muestra_envios(sociedad_id, fecha desc);
create index if not exists muestra_envios_cliente_idx
  on public.muestra_envios(cliente_id);

create table if not exists public.muestra_envio_items (
  id uuid primary key default gen_random_uuid(),
  envio_id uuid not null references public.muestra_envios(id) on delete cascade,
  producto_id uuid not null references public.muestra_productos(id) on delete restrict,
  cantidad integer not null check (cantidad > 0),
  cantidad_devuelta integer not null default 0
    check (cantidad_devuelta >= 0 and cantidad_devuelta <= cantidad),
  created_at timestamptz not null default now(),
  unique (envio_id, producto_id)
);

create index if not exists muestra_envio_items_producto_idx
  on public.muestra_envio_items(producto_id);

create or replace function public.set_muestra_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists muestra_productos_updated_at on public.muestra_productos;
create trigger muestra_productos_updated_at
before update on public.muestra_productos
for each row execute function public.set_muestra_updated_at();

drop trigger if exists muestra_envios_updated_at on public.muestra_envios;
create trigger muestra_envios_updated_at
before update on public.muestra_envios
for each row execute function public.set_muestra_updated_at();

create or replace function public.asignar_numero_muestra_envio()
returns trigger
language plpgsql
as $$
declare
  anio text := to_char(coalesce(new.fecha, current_date), 'YYYY');
  siguiente integer;
begin
  if nullif(trim(new.numero), '') is not null then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtext('muestra_envio:' || new.sociedad_id::text || ':' || anio));
  select coalesce(max(nullif(regexp_replace(numero, '^MUE-[0-9]{4}-', ''), '')::integer), 0) + 1
    into siguiente
  from public.muestra_envios
  where sociedad_id = new.sociedad_id
    and numero like 'MUE-' || anio || '-%';

  new.numero := 'MUE-' || anio || '-' || lpad(siguiente::text, 4, '0');
  return new;
end;
$$;

drop trigger if exists asignar_numero_muestra_envio on public.muestra_envios;
create trigger asignar_numero_muestra_envio
before insert on public.muestra_envios
for each row execute function public.asignar_numero_muestra_envio();

create or replace function public.validar_stock_muestra_item()
returns trigger
language plpgsql
as $$
declare
  total_disponible integer;
  total_asignado integer;
  sociedad_producto uuid;
  sociedad_envio uuid;
begin
  select stock_total, sociedad_id into total_disponible, sociedad_producto
  from public.muestra_productos
  where id = new.producto_id
  for update;

  select sociedad_id into sociedad_envio
  from public.muestra_envios
  where id = new.envio_id;

  if sociedad_producto is null or sociedad_envio is null or sociedad_producto <> sociedad_envio then
    raise exception 'La muestra y el envío deben pertenecer a la misma sociedad';
  end if;

  select coalesce(sum(cantidad - cantidad_devuelta), 0)
    into total_asignado
  from public.muestra_envio_items
  where producto_id = new.producto_id
    and id <> coalesce(new.id, gen_random_uuid());

  if total_asignado + (new.cantidad - new.cantidad_devuelta) > total_disponible then
    raise exception 'Stock de muestra insuficiente';
  end if;

  return new;
end;
$$;

drop trigger if exists validar_stock_muestra_item on public.muestra_envio_items;
create trigger validar_stock_muestra_item
before insert or update on public.muestra_envio_items
for each row execute function public.validar_stock_muestra_item();

create or replace function public.validar_stock_total_muestra()
returns trigger
language plpgsql
as $$
declare
  total_asignado integer;
begin
  select coalesce(sum(cantidad - cantidad_devuelta), 0)
    into total_asignado
  from public.muestra_envio_items
  where producto_id = new.id;

  if new.stock_total < total_asignado then
    raise exception 'El stock total no puede ser menor a las muestras que siguen en clientes';
  end if;
  return new;
end;
$$;

drop trigger if exists validar_stock_total_muestra on public.muestra_productos;
create trigger validar_stock_total_muestra
before update of stock_total on public.muestra_productos
for each row execute function public.validar_stock_total_muestra();

alter table public.muestra_productos enable row level security;
alter table public.muestra_envios enable row level security;
alter table public.muestra_envio_items enable row level security;

drop policy if exists muestra_productos_sociedad on public.muestra_productos;
create policy muestra_productos_sociedad on public.muestra_productos
for all to authenticated
using (
  exists (select 1 from public.user_sociedades us where us.user_id = auth.uid() and us.sociedad_id = muestra_productos.sociedad_id)
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('super_admin', 'admin'))
)
with check (
  exists (select 1 from public.user_sociedades us where us.user_id = auth.uid() and us.sociedad_id = muestra_productos.sociedad_id)
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('super_admin', 'admin'))
);

drop policy if exists muestra_envios_sociedad on public.muestra_envios;
create policy muestra_envios_sociedad on public.muestra_envios
for all to authenticated
using (
  exists (select 1 from public.user_sociedades us where us.user_id = auth.uid() and us.sociedad_id = muestra_envios.sociedad_id)
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('super_admin', 'admin'))
)
with check (
  exists (select 1 from public.user_sociedades us where us.user_id = auth.uid() and us.sociedad_id = muestra_envios.sociedad_id)
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('super_admin', 'admin'))
);

drop policy if exists muestra_envio_items_sociedad on public.muestra_envio_items;
create policy muestra_envio_items_sociedad on public.muestra_envio_items
for all to authenticated
using (
  exists (
    select 1 from public.muestra_envios e
    where e.id = muestra_envio_items.envio_id
      and (
        exists (select 1 from public.user_sociedades us where us.user_id = auth.uid() and us.sociedad_id = e.sociedad_id)
        or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('super_admin', 'admin'))
      )
  )
)
with check (
  exists (
    select 1 from public.muestra_envios e
    where e.id = muestra_envio_items.envio_id
      and (
        exists (select 1 from public.user_sociedades us where us.user_id = auth.uid() and us.sociedad_id = e.sociedad_id)
        or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('super_admin', 'admin'))
      )
  )
);

grant select, insert, update, delete on public.muestra_productos to authenticated;
grant select, insert, update, delete on public.muestra_envios to authenticated;
grant select, insert, update, delete on public.muestra_envio_items to authenticated;

comment on table public.muestra_productos is 'Inventario independiente de prendas usadas como muestras comerciales.';
comment on table public.muestra_envios is 'Registro de muestras entregadas temporalmente a clientes.';
comment on table public.muestra_envio_items is 'Prendas y cantidades incluidas en cada envío de muestras.';
