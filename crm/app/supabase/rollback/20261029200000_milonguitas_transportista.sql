-- Vuelta atrás de 20261029200000: Milonguitas vuelve a no transportista (como estaba).
begin;
update public.proveedores set es_transportista = false
where id in ('6730ae6f-3a03-4f91-a7f0-5649ff7539e5', '8e7bf500-7f5f-41bb-a990-e46bef717213');
commit;
