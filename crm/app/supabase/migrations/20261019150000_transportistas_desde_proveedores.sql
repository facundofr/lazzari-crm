-- Transportistas salen de Proveedores: al tildar "Transporte" en un proveedor aparece solo en
-- "¿Quién lo lleva?" y en el catálogo de Transportes; al destildarlo queda inactivo (no se borra nada).
-- Aditiva. Pedido de Augusto 19/10/2026. Vuelta atrás: supabase/rollback/20261019150000_transportistas_desde_proveedores.sql
begin;

create or replace function public.sync_transportista_desde_proveedor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cuit text := regexp_replace(coalesce(new.cuit, ''), '\D', '', 'g');
  v_id uuid;
begin
  if not new.es_transportista and not (tg_op = 'UPDATE' and old.es_transportista) then
    return new;
  end if;

  -- Mismo transportista: por CUIT, o (si no tiene CUIT) por nombre.
  select t.id into v_id
  from transportistas t
  where t.sociedad_id is not distinct from new.sociedad_id
    and ((v_cuit <> '' and regexp_replace(coalesce(t.cuit, ''), '\D', '', 'g') = v_cuit)
      or (coalesce(t.cuit, '') = '' and upper(t.nombre) in (upper(new.razon_social), upper(coalesce(new.nombre_fantasia, '')))))
  order by t.activo desc, t.created_at
  limit 1;

  if new.es_transportista then
    if v_id is null then
      insert into transportistas (sociedad_id, nombre, razon_social, cuit, telefono, email, direccion, localidad, provincia, activo)
      values (new.sociedad_id, coalesce(nullif(trim(new.nombre_fantasia), ''), new.razon_social), new.razon_social, nullif(v_cuit, ''),
              nullif(new.telefono, ''), nullif(new.email, ''), nullif(new.direccion, ''), nullif(new.localidad, ''), nullif(new.provincia, ''), true);
    else
      -- No pisa el nombre que ya usan los chicos; solo completa lo vacío y lo activa.
      update transportistas set
        activo = true,
        razon_social = coalesce(nullif(razon_social, ''), new.razon_social),
        cuit = coalesce(nullif(cuit, ''), nullif(v_cuit, '')),
        email = coalesce(nullif(email, ''), nullif(new.email, '')),
        telefono = coalesce(nullif(telefono, ''), nullif(new.telefono, ''))
      where id = v_id;
    end if;
  elsif v_id is not null then
    update transportistas set activo = false where id = v_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_transportista_desde_proveedor on public.proveedores;
create trigger trg_sync_transportista_desde_proveedor
after insert or update of es_transportista, razon_social, nombre_fantasia, cuit, email, telefono on public.proveedores
for each row execute function public.sync_transportista_desde_proveedor();

-- José Álvarez: el transportista no tenía documento; se le pone el DNI de su ficha para que se reconozcan.
update public.transportistas set cuit = '4693136' where id::text like 'ef457d77%' and coalesce(cuit, '') = '';

-- Tildar "Transporte" a los que ya están en la lista (Lazzari) y sumar a Nuevo Plus Ultra (el trigger lo agrega).
update public.proveedores set es_transportista = true
where sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021'
  and regexp_replace(coalesce(cuit, ''), '\D', '', 'g') in ('20341075085', '33539819149', '30686978350', '30712481478', '4693136', '30710320531');

commit;
