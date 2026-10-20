-- José Álvarez: precio fijo por viaje $3.000 (Augusto 19/10/2026: "el único que por defecto nos cobra lo mismo por viaje es José Álvarez").
-- Solo hace que el + de Transportes arranque con $3.000 (editable). No cambia ningún viaje ya cargado.
-- Vuelta atrás: supabase/rollback/20261019230000_alvarez_precio_fijo.sql
begin;
update public.transportistas set precio_viaje_fijo = 3000
where id = 'ef457d77-16d2-4131-8efa-9c60f9724407' and precio_viaje_fijo is null;
commit;
