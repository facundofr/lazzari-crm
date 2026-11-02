-- Prueba de 20261102160000_anular_editar_recibo (siempre se deshace: la corre migrar.cjs --probar).
-- Recibos reales: 1085 (pesos, 4 renglones, cruzado con el banco), 1041 (US$ con liquidación, cruzado con el banco),
-- 1078 (con cheque) y 1083 (un renglón repartido en 2 facturas). Como un super_admin.
select set_config('request.jwt.claims', json_build_object('sub', (select id from public.profiles where role::text='super_admin' and coalesce(active,true) limit 1), 'role','authenticated')::text, true);

-- Antes: las facturas que cobran esos recibos
create temp table _fac on commit drop as
select distinct r.numero as recibo, f.id, f.tipo || ' ' || f.punto_venta || '-' || f.numero as factura, f.estado as estado_antes
from public.recibos r join public.recibo_movimientos rm on rm.recibo_id = r.id
join public.movimientos m on m.id = rm.movimiento_id
left join public.cobro_aplicaciones ca on ca.movimiento_id = m.id
join public.facturas f on f.id = coalesce(m.factura_id, ca.factura_id)
where r.numero in (1085, 1041);

-- 1) Anular 1085 (pesos) y 1041 (US$ cruzado con el banco: antes pedía "desconciliá primero")
select 1085 as recibo, public.anular_recibo('edba8011-20f0-455b-b85c-cd84832fcc11', 'prueba')::text as resultado;
select 1041 as recibo, public.anular_recibo('0f88da90-8706-4fcf-8f38-4a893a6ab292', 'prueba')::text as resultado;
-- Otra vez: no hace nada
select 'repetido' as caso, public.anular_recibo('edba8011-20f0-455b-b85c-cd84832fcc11', 'prueba')::text as resultado;

-- Después: todos los renglones anulados y las facturas recalculadas; el banco sin cruzar
select 'despues' as momento, r.numero, count(*) as renglones, count(*) filter (where m.anulado) as anulados,
  bool_and(m.descripcion like '%Motivo: prueba') as con_motivo,
  (select count(*) from public.extracto_movimientos em where em.match_movimiento_id = any (array_agg(m.id))) as lineas_banco_cruzadas
from public.recibos r join public.recibo_movimientos rm on rm.recibo_id = r.id join public.movimientos m on m.id = rm.movimiento_id
where r.numero in (1085, 1041) group by r.numero;
select 'despues' as momento, x.recibo, x.factura, x.estado_antes, f.estado as estado_despues from _fac x join public.facturas f on f.id = x.id;
select 'cheque de 1078 antes de anular' as caso, e.numero, e.estado from public.echeqs e join public.recibo_movimientos rm on rm.movimiento_id = e.movimiento_id
join public.recibos r on r.id = rm.recibo_id where r.numero = 1078;

-- 2) Editar 1078 (con cheque): fecha y monto del renglón del cheque
select 1078 as recibo, public.editar_recibo('0737794c-6664-48e8-bb33-dc29b90f447b', '2026-10-28',
  (select jsonb_agg(jsonb_build_object('movimiento_id', m.id, 'monto', m.monto + 1)) from public.movimientos m
   join public.recibo_movimientos rm on rm.movimiento_id = m.id join public.recibos r on r.id = rm.recibo_id
   where r.numero = 1078 and exists (select 1 from public.echeqs e where e.movimiento_id = m.id)))::text as resultado;
select 'editado' as caso, r.fecha as fecha_recibo, m.fecha, m.monto, (select e.monto from public.echeqs e where e.movimiento_id = m.id limit 1) as monto_cheque,
  (select e.estado from public.echeqs e where e.movimiento_id = m.id limit 1) as estado_cheque
from public.recibos r join public.recibo_movimientos rm on rm.recibo_id = r.id join public.movimientos m on m.id = rm.movimiento_id where r.numero = 1078;

-- 3) Solo la fecha de 1083 (tiene un renglón repartido en 2 facturas: la fecha igual se cambia)
select 1083 as recibo, public.editar_recibo('0567382b-4dbf-41bd-b35f-636421bd5a4b', '2026-10-27', '[]'::jsonb)::text as resultado;
select 'fecha 1083' as caso, r.fecha, bool_and(m.fecha = '2026-10-27') as todos_los_renglones
from public.recibos r join public.recibo_movimientos rm on rm.recibo_id = r.id join public.movimientos m on m.id = rm.movimiento_id where r.numero = 1083 group by r.fecha;

-- 4) Rechazos: editar un cobro en US$ (1068, vigente) y un renglón de otro recibo
create temp table _rechazos (caso text) on commit drop;
do $$ begin
  begin
    perform public.editar_recibo('0fa50d8e-c4f3-4038-afc1-bd6299c3559c', '2026-10-21', '[]'::jsonb);
    insert into _rechazos values ('MAL: editó un cobro en US$');
  exception when others then insert into _rechazos values ('OK US$ no se edita: ' || sqlerrm); end;
  begin
    perform public.editar_recibo('0737794c-6664-48e8-bb33-dc29b90f447b', null,
      jsonb_build_array(jsonb_build_object('movimiento_id', (select movimiento_id from public.recibo_movimientos rm join public.recibos r on r.id = rm.recibo_id where r.numero = 1085 limit 1), 'monto', 1)));
    insert into _rechazos values ('MAL: aceptó un renglón de otro recibo');
  exception when others then insert into _rechazos values ('OK renglón ajeno: ' || sqlerrm); end;
end $$;
select * from _rechazos;
