-- Unifica la identidad comercial y fiscal de los transportistas con proveedores.
-- La tabla transportistas se conserva como proyeccion compatible para no romper
-- viajes historicos que ya referencian transportista_id.

alter table public.proveedores
  add column if not exists es_transportista boolean not null default false;

alter table public.transportistas
  add column if not exists proveedor_id uuid references public.proveedores(id) on delete restrict;

create unique index if not exists transportistas_proveedor_unique
  on public.transportistas (proveedor_id)
  where proveedor_id is not null;

-- Vincula primero los registros que ya existen en ambos catalogos.
with coincidencias as (
  select
    t.id as transportista_id,
    p.id as proveedor_id,
    row_number() over (partition by p.id order by t.created_at, t.id) as posicion
  from public.transportistas t
  join public.proveedores p
    on t.sociedad_id = p.sociedad_id
   and (
      (
        length(regexp_replace(coalesce(t.cuit, ''), '[^0-9]', '', 'g')) = 11
        and regexp_replace(t.cuit, '[^0-9]', '', 'g') = regexp_replace(p.cuit, '[^0-9]', '', 'g')
      )
      or lower(btrim(coalesce(t.razon_social, t.nombre))) = lower(btrim(p.razon_social))
   )
  where t.proveedor_id is null
)
update public.transportistas t
set proveedor_id = c.proveedor_id
from coincidencias c
where t.id = c.transportista_id
  and c.posicion = 1;

-- Migra al maestro de proveedores los transportistas historicos con CUIT valido
-- que todavia no tienen una ficha fiscal.
insert into public.proveedores (
  razon_social, cuit, condicion_iva, rubro, forma_pago,
  dias_cuenta_corriente, limite_credito, activo, sociedad_id,
  email, telefono, direccion, localidad, provincia, notas,
  created_by, es_transportista
)
select distinct on (t.sociedad_id, regexp_replace(t.cuit, '[^0-9]', '', 'g'))
  coalesce(nullif(btrim(t.razon_social), ''), t.nombre),
  regexp_replace(t.cuit, '[^0-9]', '', 'g'),
  'RI'::public.condicion_iva_type,
  'Transporte', 'Cuenta corriente', 30, 0, t.activo, t.sociedad_id,
  t.email, t.telefono, t.direccion, t.localidad, t.provincia,
  t.observaciones, t.created_by, true
from public.transportistas t
where t.proveedor_id is null
  and t.sociedad_id is not null
  and length(regexp_replace(coalesce(t.cuit, ''), '[^0-9]', '', 'g')) = 11
  and not exists (
    select 1
    from public.proveedores p
    where p.sociedad_id = t.sociedad_id
      and regexp_replace(p.cuit, '[^0-9]', '', 'g') = regexp_replace(t.cuit, '[^0-9]', '', 'g')
  )
order by t.sociedad_id, regexp_replace(t.cuit, '[^0-9]', '', 'g'), t.created_at, t.id;

with coincidencias as (
  select
    t.id as transportista_id,
    p.id as proveedor_id,
    row_number() over (partition by p.id order by t.created_at, t.id) as posicion
  from public.transportistas t
  join public.proveedores p
    on t.sociedad_id = p.sociedad_id
   and regexp_replace(coalesce(t.cuit, ''), '[^0-9]', '', 'g') <> ''
   and regexp_replace(t.cuit, '[^0-9]', '', 'g') = regexp_replace(p.cuit, '[^0-9]', '', 'g')
  where t.proveedor_id is null
)
update public.transportistas t
set proveedor_id = c.proveedor_id
from coincidencias c
where t.id = c.transportista_id
  and c.posicion = 1;

update public.proveedores p
set es_transportista = true
where exists (
  select 1 from public.transportistas t where t.proveedor_id = p.id
);

create or replace function public.sincronizar_proveedor_transportista()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.es_transportista then
    insert into public.transportistas (
      proveedor_id, sociedad_id, nombre, razon_social, cuit, telefono,
      email, direccion, localidad, provincia, observaciones, activo, created_by
    ) values (
      new.id, new.sociedad_id, new.razon_social, new.razon_social, new.cuit,
      new.telefono, new.email, new.direccion, new.localidad, new.provincia,
      new.notas, new.activo, new.created_by
    )
    on conflict (proveedor_id) where proveedor_id is not null do update set
      sociedad_id = excluded.sociedad_id,
      nombre = excluded.nombre,
      razon_social = excluded.razon_social,
      cuit = excluded.cuit,
      telefono = excluded.telefono,
      email = excluded.email,
      direccion = excluded.direccion,
      localidad = excluded.localidad,
      provincia = excluded.provincia,
      observaciones = excluded.observaciones,
      activo = excluded.activo;
  else
    update public.transportistas
    set activo = false
    where proveedor_id = new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists proveedores_sincronizar_transportista on public.proveedores;
create trigger proveedores_sincronizar_transportista
after insert or update of es_transportista, razon_social, cuit, telefono, email,
  direccion, localidad, provincia, notas, activo
on public.proveedores
for each row execute function public.sincronizar_proveedor_transportista();

comment on column public.proveedores.es_transportista is
  'Incluye al proveedor en el catalogo de Transportes.';
comment on column public.transportistas.proveedor_id is
  'Ficha maestra del proveedor; la tabla se conserva por compatibilidad con viajes historicos.';
