-- Compras Lazza › pestaña Mercado Libre: «No tiene factura» (Augusto 30/10/2026, "Sí, hacelos").
-- Para los artículos que no van a tener factura nunca (ej. OC-2026-1151, parlantes Jabra de Synthon que pagó Seba con su plata):
-- se marcan con un motivo y dejan de sumar en «Falta la factura». No cambia la OC, ni costos, ni facturas, ni pagos.
-- «Deshacer» no borra: marca anulado.
-- Solo AGREGA una tabla y 2 funciones: no cambia ni borra nada de lo que ya existe.
-- Vuelta atrás: supabase/rollback/20261030170000_mercado_libre_sin_factura.sql
begin;

create table if not exists public.mercado_libre_sin_factura (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users(id),
  sociedad_id uuid not null references public.sociedades(id),
  orden_compra_item_id uuid not null references public.orden_compra_items(id) on delete cascade,
  motivo text not null check (btrim(motivo) <> ''),
  anulado boolean not null default false,
  anulado_at timestamptz,
  anulado_por uuid references auth.users(id)
);
create unique index if not exists mercado_libre_sin_factura_item_activo
  on public.mercado_libre_sin_factura (orden_compra_item_id) where not anulado;

alter table public.mercado_libre_sin_factura enable row level security;
drop policy if exists mlsf_select on public.mercado_libre_sin_factura;
create policy mlsf_select on public.mercado_libre_sin_factura for select
  using (get_my_role() = any (array['super_admin'::user_role, 'admin'::user_role, 'administrativo'::user_role, 'vendedor'::user_role, 'viewer'::user_role]));

create or replace function public.marcar_mercado_libre_sin_factura(p_oc_item_id uuid, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_soc uuid;
begin
  if coalesce(get_my_role()::text, '') not in ('super_admin', 'admin', 'administrativo', 'vendedor') then
    raise exception 'No tenés permiso para marcar artículos';
  end if;
  if btrim(coalesce(p_motivo, '')) = '' then raise exception 'Escribí el motivo'; end if;
  select o.sociedad_id into v_soc from orden_compra_items i join ordenes_compra o on o.id = i.orden_id where i.id = p_oc_item_id;
  if v_soc is null then raise exception 'No se encontró el artículo'; end if;
  if exists (select 1 from mercado_libre_sin_factura where orden_compra_item_id = p_oc_item_id and not anulado) then
    return jsonb_build_object('marcados', 0);
  end if;
  insert into mercado_libre_sin_factura (sociedad_id, orden_compra_item_id, motivo, created_by)
  values (v_soc, p_oc_item_id, btrim(p_motivo), auth.uid());
  return jsonb_build_object('marcados', 1);
end $$;

create or replace function public.desmarcar_mercado_libre_sin_factura(p_oc_item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer := 0;
begin
  if coalesce(get_my_role()::text, '') not in ('super_admin', 'admin', 'administrativo', 'vendedor') then
    raise exception 'No tenés permiso para desmarcar artículos';
  end if;
  update mercado_libre_sin_factura set anulado = true, anulado_at = now(), anulado_por = auth.uid()
  where orden_compra_item_id = p_oc_item_id and not anulado;
  get diagnostics v_n = row_count;
  return jsonb_build_object('desmarcados', v_n);
end $$;

revoke all on function public.marcar_mercado_libre_sin_factura(uuid, text) from public, anon;
revoke all on function public.desmarcar_mercado_libre_sin_factura(uuid) from public, anon;
grant execute on function public.marcar_mercado_libre_sin_factura(uuid, text) to authenticated;
grant execute on function public.desmarcar_mercado_libre_sin_factura(uuid) to authenticated;
grant select on public.mercado_libre_sin_factura to authenticated;

commit;
