-- Nuevo Plus Ultra S.A. (CUIT 30710320531) era la ex firma de Rapido Plus Ultra. Sin facturas, pagos ni viajes (verificado 29/10/2026).
-- Se borra la ficha de proveedor y su transportista. Si algo los usara, la base frena el borrado (nada se pierde a escondidas).
-- Vuelta atrás: supabase/rollback/20261029150000_borrar_nuevo_plus_ultra.sql (los vuelve a crear, inactivos)
begin;
delete from public.transportistas where id = '59545905-00fb-41ae-b407-3fb42808fd85' and cuit = '30710320531'
  and not exists (select 1 from public.transportes x where x.transportista_id = '59545905-00fb-41ae-b407-3fb42808fd85');
delete from public.proveedores where id = 'db1a182b-6bff-423f-8956-c4259ad9c1d4' and cuit = '30710320531'
  and not exists (select 1 from public.facturas_compra f where f.proveedor_id = 'db1a182b-6bff-423f-8956-c4259ad9c1d4')
  and not exists (select 1 from public.ordenes_pago o where o.proveedor_id = 'db1a182b-6bff-423f-8956-c4259ad9c1d4');
commit;
