-- Nuevo Plus Ultra no se usa más; lo reemplaza Rapido Plus Ultra (Lazzari). Pedido de Augusto 19/10/2026.
-- Nuevo Plus Ultra no tiene facturas, OC ni viajes. Vuelta atrás: supabase/rollback/20261019160000_rapido_plus_ultra.sql
begin;
-- Destildar Nuevo: el trigger deja inactivo su transportista. La ficha no se borra, queda inactiva con nota.
update public.proveedores set es_transportista = false, activo = false,
  notas = 'NO USAR: reemplazado por Rapido Plus Ultra S. A. (19/10/2026).'
where id = 'db1a182b-6bff-423f-8956-c4259ad9c1d4';
-- Rapido ya estaba tildado pero sin transportista: se vuelve a tildar para que el trigger lo sume a la lista.
update public.proveedores set es_transportista = true where id = '3f52cb50-6fc6-4f5b-aa5e-fc07f3322e3e';
commit;
