begin;

create table if not exists public.lista_precios_reglas (
  id uuid primary key default gen_random_uuid(),
  lista_id uuid not null references public.listas_precios(id) on delete cascade,
  sociedad_id uuid not null references public.sociedades(id) on delete cascade,
  tipo text not null check (tipo in ('global', 'categoria', 'cantidad')),
  nombre text not null,
  descuento numeric(7,4) not null check (descuento between 0 and 100),
  categoria text,
  cantidad_desde numeric(18,4),
  cantidad_hasta numeric(18,4),
  vigencia_desde date,
  vigencia_hasta date,
  prioridad integer not null default 0,
  activa boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (vigencia_hasta is null or vigencia_desde is null or vigencia_hasta >= vigencia_desde),
  check (cantidad_desde is null or cantidad_desde >= 0),
  check (cantidad_hasta is null or cantidad_hasta >= 0),
  check (cantidad_hasta is null or cantidad_desde is null or cantidad_hasta >= cantidad_desde),
  check (tipo <> 'categoria' or nullif(btrim(categoria), '') is not null),
  check (tipo <> 'cantidad' or cantidad_desde is not null or cantidad_hasta is not null)
);

create index if not exists lista_precios_reglas_lista_prioridad_idx
  on public.lista_precios_reglas(lista_id, activa, prioridad desc);
create index if not exists lista_precios_reglas_sociedad_idx
  on public.lista_precios_reglas(sociedad_id);

create or replace function public.validar_regla_lista_sociedad()
returns trigger language plpgsql set search_path = public as $$
declare v_sociedad uuid;
begin
  select sociedad_id into v_sociedad from public.listas_precios where id = new.lista_id;
  if v_sociedad is null or v_sociedad is distinct from new.sociedad_id then
    raise exception 'La regla y la lista deben pertenecer a la misma sociedad' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists validar_regla_lista_sociedad on public.lista_precios_reglas;
create trigger validar_regla_lista_sociedad
before insert or update on public.lista_precios_reglas
for each row execute function public.validar_regla_lista_sociedad();

alter table public.lista_precios_reglas enable row level security;
drop policy if exists lista_precios_reglas_sociedad on public.lista_precios_reglas;
drop policy if exists lista_precios_reglas_select on public.lista_precios_reglas;
drop policy if exists lista_precios_reglas_insert on public.lista_precios_reglas;
drop policy if exists lista_precios_reglas_update on public.lista_precios_reglas;
drop policy if exists lista_precios_reglas_delete on public.lista_precios_reglas;

create policy lista_precios_reglas_select on public.lista_precios_reglas
for select to authenticated
using (exists (
  select 1 from public.user_sociedades us
  where us.user_id = auth.uid() and us.sociedad_id = lista_precios_reglas.sociedad_id
));

create policy lista_precios_reglas_insert on public.lista_precios_reglas
for insert to authenticated
with check (exists (
  select 1 from public.user_sociedades us
  where us.user_id = auth.uid() and us.sociedad_id = lista_precios_reglas.sociedad_id
  ) and exists (
    select 1 from public.profiles p where p.id = auth.uid()
      and p.role::text in ('super_admin', 'admin', 'administrativo')
  ));

create policy lista_precios_reglas_update on public.lista_precios_reglas
for update to authenticated
using (exists (
  select 1 from public.user_sociedades us
  where us.user_id = auth.uid() and us.sociedad_id = lista_precios_reglas.sociedad_id
  ) and exists (
    select 1 from public.profiles p where p.id = auth.uid()
      and p.role::text in ('super_admin', 'admin', 'administrativo')
  ))
with check (exists (
  select 1 from public.user_sociedades us
  where us.user_id = auth.uid() and us.sociedad_id = lista_precios_reglas.sociedad_id
  ) and exists (
    select 1 from public.profiles p where p.id = auth.uid()
      and p.role::text in ('super_admin', 'admin', 'administrativo')
  ));

create policy lista_precios_reglas_delete on public.lista_precios_reglas
for delete to authenticated
using (exists (
  select 1 from public.user_sociedades us
  where us.user_id = auth.uid() and us.sociedad_id = lista_precios_reglas.sociedad_id
  ) and exists (
    select 1 from public.profiles p where p.id = auth.uid()
      and p.role::text in ('super_admin', 'admin')
  ));

comment on table public.lista_precios_reglas is
  'Reglas por lista. Gana mayor prioridad; a igual prioridad: cantidad, categoria y global.';
comment on column public.lista_precios_reglas.descuento is
  'Descuento adicional aplicado sobre el precio neto manual del item, sin sobrescribirlo.';

commit;
