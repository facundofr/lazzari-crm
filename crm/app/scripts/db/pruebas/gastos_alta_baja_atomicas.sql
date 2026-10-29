-- Prueba de 20261029100000 (la corre migrar.cjs --probar y deshace todo): crea un gasto con su pago y lo borra.
select set_config('request.jwt.claims', json_build_object('sub', (select id from public.profiles where role::text='super_admin' and coalesce(active,true) limit 1), 'role','authenticated')::text, true);
create temp table _g as select public.crear_gasto_con_pago('eee2a3c8-fe6c-494d-bd2f-7a5d8067d021',
  '{"fecha":"2026-10-29","descripcion":"PRUEBA gasto atómico","categoria":"Operativos","grupo":"Operativos","monto":"1234.5","moneda":"ARS","tipo_recurrencia":"eventual"}'::jsonb,
  'Gasto — Operativos — PRUEBA gasto atómico') as id;
select 'creado' paso, g.descripcion, g.monto, (select count(*) from public.movimientos m where m.gasto_manual_id = g.id and not m.anulado) pagos_vivos
from public.gastos_manuales g where g.id = (select id from _g);
select 'borrado' paso, public.borrar_gasto((select id from _g)) resultado;
select 'despues' paso, (select count(*) from public.gastos_manuales where id = (select id from _g)) gastos,
  (select count(*) from public.movimientos where descripcion like '%PRUEBA gasto atómico%' and anulado) pagos_anulados;
-- Datos inválidos: tiene que fallar sin crear nada (se atrapa para seguir la prueba)
do $$ begin
  perform public.crear_gasto_con_pago('eee2a3c8-fe6c-494d-bd2f-7a5d8067d021', '{"fecha":"2026-10-29","descripcion":"x","monto":"0"}'::jsonb, null);
  raise notice 'MAL: aceptó monto 0';
exception when others then raise notice 'OK: monto 0 rechazado (%)', sqlerrm;
end $$;
