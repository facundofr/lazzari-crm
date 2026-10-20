-- Vuelta atrás de 20261019230000_alvarez_precio_fijo.sql: Álvarez queda sin precio fijo (como estaba).
begin;
update public.transportistas set precio_viaje_fijo = null
where id = 'ef457d77-16d2-4131-8efa-9c60f9724407';
commit;
