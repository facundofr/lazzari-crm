-- 15/10/2026, con OK de Augusto ("avanza con todo, te autorizo para que hagas supabase también").
-- Compras en piloto automático, parte 1: pantalla "Compras nueva".
--   1) profiles.prueba_compras_nueva: casilla por usuario (solo la cambia el super_admin). Se prende para Augusto y Sebastián.
--   2) orden_compra_items.presupuesto_item_id: cada renglón de OC atado a su renglón del PR
--      (se completa en las OC existentes solo cuando hay un único renglón del PR que coincide).
--   3) ordenes_compra.pedido_at / pedido_via / pedido_por / nota_ia: cuándo, por dónde y quién mandó el pedido.
-- Aditiva: no borra datos.
-- Vuelta atrás: supabase/rollback/20261015130000_compras_piloto_parte1.sql
begin;

-- 1) Casilla por usuario
alter table public.profiles
  add column if not exists prueba_compras_nueva boolean not null default false;
comment on column public.profiles.prueba_compras_nueva is 'Ve la pantalla Compras nueva y se encarga de mandar los pedidos (prueba)';

create or replace function public.lz_proteger_prueba_compras()
returns trigger
language plpgsql
security definer
set search_path to public
as $function$
begin
  if new.prueba_compras_nueva is distinct from old.prueba_compras_nueva
    and not public.lz_puede_manejar_usuarios() then
    raise exception 'Solo el super admin puede cambiar "Prueba: Compras nueva"';
  end if;
  return new;
end;
$function$;

drop trigger if exists lz_proteger_prueba_compras on public.profiles;
create trigger lz_proteger_prueba_compras
  before update on public.profiles
  for each row execute function public.lz_proteger_prueba_compras();

update public.profiles set prueba_compras_nueva = true
  where email in ('augusto@lazzari.com.ar', 'seba@lazzari.com.ar');

-- 2) Renglón de OC → renglón del PR
alter table public.orden_compra_items
  add column if not exists presupuesto_item_id uuid
    references public.presupuesto_items(id) on delete set null;
comment on column public.orden_compra_items.presupuesto_item_id is 'Renglón del PR del que sale este renglón de la OC';
create index if not exists idx_oc_items_pr_item on public.orden_compra_items(presupuesto_item_id);

-- OC existentes con PR de origen: solo si hay un único renglón del PR con el mismo código y descripción
update public.orden_compra_items oi
set presupuesto_item_id = m.pi_id
from (
  select oi2.id as oi_id, min(pi.id::text)::uuid as pi_id
  from public.orden_compra_items oi2
  join public.ordenes_compra oc on oc.id = oi2.orden_id
  join public.presupuesto_items pi on pi.presupuesto_id = oc.presupuesto_origen_id
    and coalesce(pi.codigo, '') = coalesce(oi2.codigo, '')
    and coalesce(pi.descripcion, '') = coalesce(oi2.descripcion, '')
  where oc.presupuesto_origen_id is not null and oi2.presupuesto_item_id is null
  group by oi2.id
  having count(*) = 1
) m
where oi.id = m.oi_id;

-- 3) Pedido mandado
alter table public.ordenes_compra
  add column if not exists pedido_at timestamptz,
  add column if not exists pedido_via text,
  add column if not exists pedido_por uuid references public.profiles(id),
  add column if not exists nota_ia text;
comment on column public.ordenes_compra.pedido_at is 'Cuándo se mandó el pedido al proveedor';
comment on column public.ordenes_compra.pedido_via is 'mail | whatsapp | manual';
comment on column public.ordenes_compra.pedido_por is 'Quién mandó el pedido';
comment on column public.ordenes_compra.nota_ia is 'Explicación de la IA al armar el pedido';

commit;
