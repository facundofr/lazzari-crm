-- Prueba de 20261029171000 (la corre migrar.cjs --probar y deshace todo). OC de prueba de un PR real con 3 artículos:
-- X (2 pedidos, 2 llegados), Y y Z (nada llegado). Dos proveedores reales de Lazzari (P1 = el de la OC, P2 = el nuevo).
select set_config('request.jwt.claims', json_build_object('sub', (select id from public.profiles where role::text='super_admin' and coalesce(active,true) limit 1), 'role','authenticated')::text, true);
create temp table _log (r text);
create temp table _p as select
  (select id from public.proveedores where sociedad_id='eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and activo order by razon_social limit 1) p1,
  (select id from public.proveedores where sociedad_id='eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and activo order by razon_social offset 1 limit 1) p2,
  (select pi.id from public.presupuesto_items pi join public.presupuestos p on p.id = pi.presupuesto_id where p.sociedad_id='eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' order by p.created_at desc limit 1) pr_item,
  (select pi.id from public.presupuesto_items pi join public.presupuestos p on p.id = pi.presupuesto_id where p.sociedad_id='eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' order by p.created_at desc offset 50 limit 1) pr_item_otro;
create temp table _oc as
  with o as (insert into public.ordenes_compra (numero, sociedad_id, proveedor_id, presupuesto_origen_id, estado, pedido, observaciones)
             select 'OC-PRUEBA-EDITAR', 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021', p1, (select presupuesto_id from public.presupuesto_items where id = pr_item), 'recibida_parcial', true, 'PRUEBA editar OC' from _p
             returning id, updated_at)
  select * from o;
create temp table _it as
  with i as (insert into public.orden_compra_items (orden_id, codigo, descripcion, cantidad, cantidad_recibida, precio_unitario, orden)
             select id, c, d, q, r, 100, n from _oc, (values ('X','PRUEBA X',2,2,1),('Y','PRUEBA Y',3,0,2),('Z','PRUEBA Z',1,0,3)) v(c,d,q,r,n) returning id, codigo)
  select * from i;
create temp table _antes as select (select updated_at from _oc) u,
  (select jsonb_agg(jsonb_build_object('id', id, 'codigo', codigo, 'descripcion', descripcion, 'cantidad', cantidad, 'precio_unitario', precio_unitario))
   from public.orden_compra_items where orden_id = (select id from _oc)) items;
select '0 costo PR antes' paso, (select precio_costo from public.presupuesto_items where id = (select pr_item from _p)) pr, (select precio_costo from public.presupuesto_items where id = (select pr_item_otro from _p)) otro;

-- 1) Alguien cambió Y mientras estaba abierta → pide confirmar y no guarda nada
update public.orden_compra_items set cantidad = 4 where id = (select id from _it where codigo='Y');
select '1 confirmar' paso, public.guardar_oc_lazza((select id from _oc), 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021', jsonb_build_object(
  'antes', jsonb_build_object('items', (select items from _antes)),
  'sacar', jsonb_build_array((select id from _it where codigo='Z'))))::text r;
select '1 sigue Z' paso, count(*) from public.orden_compra_items where orden_id = (select id from _oc);

-- 2) Confirmado: saca Z, Y a $150, agrega W, X pasa a P2 (OC nueva), costo al PR (el de otro PR no se toca)
select '2 guardar' paso, public.guardar_oc_lazza((select id from _oc), 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021', jsonb_build_object(
  'sacar', jsonb_build_array((select id from _it where codigo='Z')),
  'cambios', jsonb_build_array(jsonb_build_object('id', (select id from _it where codigo='Y'), 'precio_unitario', 150),
                               jsonb_build_object('id', (select id from _it where codigo='X'), 'proveedor_id', (select p2 from _p))),
  'nuevos', jsonb_build_array(jsonb_build_object('codigo', 'W', 'descripcion', 'PRUEBA W', 'cantidad', 1, 'precio_unitario', 10, 'iva_porcentaje', 21, 'orden', 4, 'proveedor_id', (select p1 from _p))),
  'encabezado', jsonb_build_object('proveedor_id', (select p1 from _p), 'subtotal', 1, 'iva', 0, 'total', 1, 'observaciones', 'PRUEBA editada', 'fecha_entrega_estimada', '2026-11-05'),
  'mover', jsonb_build_array(jsonb_build_object('proveedor_id', (select p2 from _p), 'proveedor_nombre', 'P2', 'item_ids', jsonb_build_array((select id from _it where codigo='X')))),
  'pr', jsonb_build_object('costos', jsonb_build_array(jsonb_build_object('id', (select pr_item from _p), 'precio_costo', 12345.67, 'costo_moneda', 'ARS'),
                                                      jsonb_build_object('id', (select pr_item_otro from _p), 'precio_costo', 1, 'costo_moneda', 'ARS')))
), true)::text r;
select '2 origen' paso, o.numero, o.estado, o.observaciones, o.fecha_entrega_estimada, string_agg(i.codigo || ':' || i.precio_unitario || ':' || i.cantidad_recibida, ', ' order by i.orden) renglones
from public.ordenes_compra o left join public.orden_compra_items i on i.orden_id = o.id where o.id = (select id from _oc) group by o.id;
select '2 destino' paso, o.numero <> 'OC-PRUEBA-EDITAR' otra_oc, o.estado, o.proveedor_id = (select p2 from _p) es_p2, o.observaciones, string_agg(i.codigo || ':' || i.cantidad_recibida, ', ') renglones
from public.orden_compra_items i join public.ordenes_compra o on o.id = i.orden_id where i.id = (select id from _it where codigo='X') group by o.id;
select '2 costo PR' paso, (select precio_costo from public.presupuesto_items where id = (select pr_item from _p)) pr, (select precio_costo from public.presupuesto_items where id = (select pr_item_otro from _p)) otro_sin_cambio;

-- 3) Pasar Y y W también a P2 → van a la OC del paso 2 (sin pedir) y la de prueba queda vacía: cancelada
select '3 vaciar' paso, public.guardar_oc_lazza((select id from _oc), 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021', jsonb_build_object(
  'mover', jsonb_build_array(jsonb_build_object('proveedor_id', (select p2 from _p), 'proveedor_nombre', 'P2',
    'item_ids', (select jsonb_agg(id) from public.orden_compra_items where orden_id = (select id from _oc))))), true)::text r;
select '3 origen' paso, estado, observaciones, (select count(*) from public.orden_compra_items where orden_id = (select id from _oc)) renglones from public.ordenes_compra where id = (select id from _oc);

-- 4) Un error a mitad (artículo que no existe) no deja nada a medias
do $$ declare v_obs text; begin
  update public.ordenes_compra set estado = 'enviada', observaciones = 'antes del error' where id = (select id from _oc);
  insert into public.orden_compra_items (orden_id, codigo, descripcion, cantidad, precio_unitario) select id, 'V', 'PRUEBA V', 1, 5 from _oc;
  begin
    perform public.guardar_oc_lazza((select id from _oc), 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021', jsonb_build_object(
      'encabezado', jsonb_build_object('observaciones', 'NO TIENE QUE QUEDAR'),
      'cambios', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'precio_unitario', 1))), true);
    insert into _log values ('MAL: aceptó un artículo que no existe');
  exception when others then
    select observaciones into v_obs from public.ordenes_compra where id = (select id from _oc);
    insert into _log values ('OK: error a mitad → ' || sqlerrm || ' · observaciones siguen: ' || v_obs);
  end;
end $$;
select 'controles' paso, r from _log;
