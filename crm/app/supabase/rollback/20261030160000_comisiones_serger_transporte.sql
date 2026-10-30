-- Vuelta atrás de 20261030160000_comisiones_serger_transporte.sql: destilda el proveedor (el trigger deja el transportista inactivo)
-- y borra el transportista que se creó si no tiene viajes.
begin;
update public.proveedores set es_transportista = false
where id = '70274f7c-458f-4f09-90eb-2792e1babbea';
delete from public.transportistas t
where t.sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and upper(t.nombre) like 'COMISIONES SERGER%'
  and not exists (select 1 from public.transportes x where x.transportista_id = t.id);
commit;
