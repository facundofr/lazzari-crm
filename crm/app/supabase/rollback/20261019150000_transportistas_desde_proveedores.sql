-- Vuelta atrás de 20261019150000_transportistas_desde_proveedores.sql.
-- Saca el trigger y deja las marcas como estaban el 19/10/2026. El transportista de Nuevo Plus Ultra queda inactivo (no se borra por si tiene viajes).
begin;
drop trigger if exists trg_sync_transportista_desde_proveedor on public.proveedores;
drop function if exists public.sync_transportista_desde_proveedor();
update public.proveedores set es_transportista = false
where sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021'
  and regexp_replace(coalesce(cuit, ''), '\D', '', 'g') in ('20341075085', '33539819149', '30686978350', '30712481478', '4693136');
update public.transportistas set activo = false where cuit = '30710320531';
update public.transportistas set cuit = null where id::text like 'ef457d77%' and cuit = '4693136';
commit;
