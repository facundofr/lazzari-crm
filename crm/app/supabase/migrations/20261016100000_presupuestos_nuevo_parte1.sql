-- 16/10/2026. Presupuestos nuevo, tandas A y B (IA arma el PR desde el pedido + pantalla de revisión).
--   1) profiles.prueba_presupuestos_nuevo: casilla por usuario (solo la cambia el super_admin). Se prende para Augusto, Sebastián y Jero.
--   2) presupuestos: origen del pedido y resumen de la IA.
--   3) presupuesto_items: lo que pidió el cliente, artículo de la lista, proveedor sugerido y confianza de la IA.
-- Aditiva: no borra datos.
-- Vuelta atrás: supabase/rollback/20261016100000_presupuestos_nuevo_parte1.sql
begin;

-- 1) Casilla por usuario
alter table public.profiles
  add column if not exists prueba_presupuestos_nuevo boolean not null default false;
comment on column public.profiles.prueba_presupuestos_nuevo is 'Ve la pantalla Presupuestos nuevo (IA que arma el PR) (prueba)';

create or replace function public.lz_proteger_prueba_presupuestos()
returns trigger
language plpgsql
security definer
set search_path to public
as $function$
begin
  if new.prueba_presupuestos_nuevo is distinct from old.prueba_presupuestos_nuevo
    and not public.lz_puede_manejar_usuarios() then
    raise exception 'Solo el super admin puede cambiar "Prueba: Presupuestos nuevo"';
  end if;
  return new;
end;
$function$;

drop trigger if exists lz_proteger_prueba_presupuestos on public.profiles;
create trigger lz_proteger_prueba_presupuestos
  before update on public.profiles
  for each row execute function public.lz_proteger_prueba_presupuestos();

update public.profiles set prueba_presupuestos_nuevo = true
  where email in ('augusto@lazzari.com.ar', 'seba@lazzari.com.ar', 'jero@lazzari.com.ar');

-- 2) Presupuesto: de dónde vino y qué hizo la IA
alter table public.presupuestos
  add column if not exists origen_pedido text,
  add column if not exists origen_ref text,
  add column if not exists ia_armado_at timestamptz,
  add column if not exists ia_resumen text;
comment on column public.presupuestos.origen_pedido is 'texto | foto | archivo | mail | whatsapp (cómo llegó el pedido del cliente)';
comment on column public.presupuestos.origen_ref is 'Referencia del origen (ej. id del mail) para no duplicar';
comment on column public.presupuestos.ia_armado_at is 'Cuándo lo armó la IA';
comment on column public.presupuestos.ia_resumen is 'Resumen de la IA al armar el PR';

-- 3) Renglón: lo pedido y lo que eligió la IA
alter table public.presupuesto_items
  add column if not exists pedido_texto text,
  add column if not exists catalogo_id uuid,
  add column if not exists proveedor_sugerido_id uuid references public.proveedores(id) on delete set null,
  add column if not exists ia_confianza text,
  add column if not exists ia_nota text;
comment on column public.presupuesto_items.pedido_texto is 'Lo que pidió el cliente, tal cual';
comment on column public.presupuesto_items.catalogo_id is 'Artículo de la lista de costos elegido (catalogo_costos.id)';
comment on column public.presupuesto_items.proveedor_sugerido_id is 'Proveedor sugerido por la IA';
comment on column public.presupuesto_items.ia_confianza is 'alta | media | baja | ninguna';
comment on column public.presupuesto_items.ia_nota is 'Aviso corto de la IA para revisar';

commit;
