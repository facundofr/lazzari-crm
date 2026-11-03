-- Remitos solo en Remitos (Augusto 03/11/2026: "Si se pone o cambia algo en remito, queda solo en remito,
-- no quiero que nada de remito vaya a transporte"; plan aprobado: "Sí, avanzá").
-- Desde ahora "¿Quién lo lleva?" guarda todo en el remito y no crea, corrige ni cancela viajes en Transportes.
-- 1) Columna nueva remitos.entrega_propia = "Lo llevamos nosotros" (antes solo quedaba en el viaje tipo interno).
-- 2) Los remitos viejos se quedan con lo que mostraban por su viaje vigente (el último no cancelado):
--    entrega_propia en los que tienen viaje interno, y el transportista en los que tenían viaje con transportista
--    y el remito vacío (los 2 de "TRANSPORTE HERO" sin id se cruzan por nombre con Transporte Hero S.R.L.).
-- Lo que cambia queda respaldado en lz_remitos_entrega_antes (para la vuelta atrás). No toca Transportes. Aditivo.
-- Vuelta atrás: supabase/rollback/20261103150000_remitos_entrega_propia.sql
begin;

alter table public.remitos add column if not exists entrega_propia boolean not null default false;
comment on column public.remitos.entrega_propia is
  '"¿Quién lo lleva?" = Lo llevamos nosotros (03/11/2026). El remito ya no crea viajes en Transportes.';

create table if not exists public.lz_remitos_entrega_antes (
  remito_id uuid primary key references public.remitos(id) on delete cascade,
  transportista_id_antes uuid,
  entrega_propia_antes boolean not null,
  respaldado_at timestamptz not null default now()
);
alter table public.lz_remitos_entrega_antes enable row level security;
comment on table public.lz_remitos_entrega_antes is
  'Respaldo de la migración 20261103150000 (remitos que tomaron transportista o Lo llevamos nosotros de su viaje). Solo para la vuelta atrás.';

create temp table lz_vigente on commit drop as
select distinct on (t.remito_id)
  t.remito_id,
  t.tipo,
  coalesce(
    t.transportista_id,
    case when lower(btrim(coalesce(t.transportista, ''))) = 'transporte hero' then
      (select x.id from public.transportistas x
       where x.sociedad_id = t.sociedad_id and x.activo and lower(x.nombre) like 'transporte hero%'
       order by x.created_at limit 1)
    end
  ) as transportista_id
from public.transportes t
where t.remito_id is not null and t.estado <> 'cancelado'
order by t.remito_id, t.created_at desc;

create temp table lz_cambia on commit drop as
select r.id as remito_id, r.transportista_id as transportista_id_antes, r.entrega_propia as entrega_propia_antes,
       (v.tipo = 'interno') as propia, v.transportista_id as nuevo
from public.remitos r
join lz_vigente v on v.remito_id = r.id
where (v.tipo = 'interno' and not r.entrega_propia)
   or (v.tipo <> 'interno' and r.transportista_id is null and v.transportista_id is not null);

insert into public.lz_remitos_entrega_antes (remito_id, transportista_id_antes, entrega_propia_antes)
select remito_id, transportista_id_antes, entrega_propia_antes from lz_cambia
on conflict (remito_id) do nothing;

update public.remitos r set entrega_propia = true
from lz_cambia c where c.remito_id = r.id and c.propia;

update public.remitos r set transportista_id = c.nuevo
from lz_cambia c where c.remito_id = r.id and not c.propia;

commit;
