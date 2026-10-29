-- Prueba de 20261029170000 (la corre migrar.cjs --probar y deshace todo): OC de prueba con 2 artículos (10 y 5 pedidos).
select set_config('request.jwt.claims', json_build_object('sub', (select id from public.profiles where role::text='super_admin' and coalesce(active,true) limit 1), 'role','authenticated')::text, true);
create temp table _log (r text);
create temp table _oc as
  with o as (insert into public.ordenes_compra (numero, sociedad_id, estado, observaciones) values ('OC-PRUEBA-LLEGO', 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021', 'enviada', 'PRUEBA llegada atómica') returning id)
  select id from o;
create temp table _it as
  with i as (insert into public.orden_compra_items (orden_id, codigo, descripcion, cantidad, precio_unitario, orden)
             select id, c, d, q, 100, n from _oc, (values ('A','PRUEBA A',10,1),('B','PRUEBA B',5,2)) v(c,d,q,n) returning id, codigo)
  select * from i;
-- 1) Parcial: llegan 4 de A → recibida_parcial
select '1 parcial' paso, public.registrar_llegada_oc((select id from _oc), 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021',
  jsonb_build_array(jsonb_build_object('item_id', (select id from _it where codigo='A'), 'cantidad', 4)), 'sumar')::text r;
-- 2) Otra persona suma 20 de A (de más) y 5 de B → A queda en 10 (no pasa de lo pedido), recibida
select '2 completo' paso, public.registrar_llegada_oc((select id from _oc), 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021',
  jsonb_build_array(jsonb_build_object('item_id', (select id from _it where codigo='A'), 'cantidad', 20), jsonb_build_object('item_id', (select id from _it where codigo='B'), 'cantidad', 5)), 'sumar')::text r;
select '2 renglones' paso, codigo, cantidad, cantidad_recibida from public.orden_compra_items where orden_id = (select id from _oc) order by orden;
-- 3) Corregir: A y B a 0 → vuelve a enviada
select '3 corregir a 0' paso, public.registrar_llegada_oc((select id from _oc), 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021',
  jsonb_build_array(jsonb_build_object('item_id', (select id from _it where codigo='A'), 'cantidad', 0), jsonb_build_object('item_id', (select id from _it where codigo='B'), 'cantidad', 0)), 'corregir')::text r;
-- 4) Artículo de otra OC: tiene que fallar sin guardar nada
do $$ begin
  perform public.registrar_llegada_oc((select id from _oc), 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021',
    jsonb_build_array(jsonb_build_object('item_id', (select id from _it where codigo='A'), 'cantidad', 3), jsonb_build_object('item_id', gen_random_uuid(), 'cantidad', 1)), 'sumar');
  insert into _log values ('MAL: aceptó un artículo que no es de la OC');
exception when others then insert into _log values ('OK: artículo ajeno rechazado ' || ' → ' || sqlerrm);
end $$;
select '4 sin cambios' paso, codigo, cantidad_recibida, (select estado from public.ordenes_compra where id = (select id from _oc)) estado
from public.orden_compra_items where orden_id = (select id from _oc) order by orden;
-- 5) Otra sociedad: no encuentra la OC
do $$ begin
  perform public.registrar_llegada_oc((select id from _oc), 'fee94607-747a-4e87-ba24-aff9032f7a56', '[]'::jsonb, 'sumar');
  insert into _log values ('MAL: encontró la OC en otra sociedad');
exception when others then insert into _log values ('OK: otra sociedad rechazada ' || ' → ' || sqlerrm);
end $$;
select 'controles' paso, r from _log;
