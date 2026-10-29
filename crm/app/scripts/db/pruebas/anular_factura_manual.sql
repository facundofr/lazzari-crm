-- Prueba de 20261029110000 (la corre migrar.cjs --probar y deshace todo): anula y revierte la X 0000-00000001 (cobrada, PR-2026-1015).
select set_config('request.jwt.claims', json_build_object('sub', (select id from public.profiles where role::text='super_admin' and coalesce(active,true) limit 1), 'role','authenticated')::text, true);
select 'anular' paso, public.gestionar_factura_manual('640a58fa-4aaa-48b9-8e09-2d0dd5ddf163', 'anular') r;
select 'tras anular' paso, f.estado::text factura, p.estado::text pr,
  (select count(*) || ' / ' || coalesce(sum(monto),0) from public.movimientos m where m.descripcion = 'Saldo a favor: cobro de la X 0000-00000001 anulada' and not m.anulado) ajustes_a_favor
from public.facturas f left join public.presupuestos p on p.id = f.presupuesto_id where f.id = '640a58fa-4aaa-48b9-8e09-2d0dd5ddf163';
select 'revertir' paso, public.gestionar_factura_manual('640a58fa-4aaa-48b9-8e09-2d0dd5ddf163', 'revertir') r;
select 'tras revertir' paso, f.estado::text factura, p.estado::text pr,
  (select count(*) from public.movimientos m where m.descripcion = 'Saldo a favor: cobro de la X 0000-00000001 anulada' and not m.anulado) ajustes_vivos
from public.facturas f left join public.presupuestos p on p.id = f.presupuesto_id where f.id = '640a58fa-4aaa-48b9-8e09-2d0dd5ddf163';
