-- Prueba de 20261102180000_saldos_fuera_de_pendientes.sql (se corre con migrar.cjs --probar: todo se deshace).
-- Como Augusto: sacar el saldo de $ 4.355,48 de la FB 16-2 de Pergamino, no duplicar, los controles y volver a pendientes.
select set_config('request.jwt.claims', json_build_object('sub', (select id from profiles where email = 'augusto@lazzari.com.ar'), 'role', 'authenticated')::text, true);

select 'sacar' q, public.sacar_saldo_de_pendientes(
  (select f.id from facturas f join clientes c on c.id = f.cliente_id where c.cuit = '30999034515' and f.tipo = 'FB' and f.punto_venta = 16 and f.numero = 2),
  null, 4355.48, 'ARS') r;
select 'otra_vez' q, public.sacar_saldo_de_pendientes(
  (select f.id from facturas f join clientes c on c.id = f.cliente_id where c.cuit = '30999034515' and f.tipo = 'FB' and f.punto_venta = 16 and f.numero = 2),
  null, 4355.48, 'ARS') r;
select 'fila' q, s.saldo, s.moneda, s.anulado, s.created_by = (select id from profiles where email = 'augusto@lazzari.com.ar') por_augusto,
  s.sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' lazzari
from saldos_fuera_de_pendientes s;

create temp table _r (caso text, resultado text) on commit drop;
do $$
declare
  v_fc uuid := (select id from facturas_compra where estado::text <> 'anulada' order by created_at desc limit 1);
  v_usd uuid := (select id from facturas where moneda = 'USD' and estado::text <> 'anulada' order by created_at desc limit 1);
begin
  begin perform public.sacar_saldo_de_pendientes(null, null, 100, 'ARS'); insert into _r values ('sin factura', 'NO FALLÓ');
  exception when others then insert into _r values ('sin factura', sqlerrm); end;
  begin perform public.sacar_saldo_de_pendientes(null, v_fc, 25000, 'ARS'); insert into _r values ('25.000 pesos', 'NO FALLÓ');
  exception when others then insert into _r values ('25.000 pesos', sqlerrm); end;
  begin perform public.sacar_saldo_de_pendientes(v_usd, null, 20, 'USD'); insert into _r values ('US$ 20 (más de $ 20.000)', 'NO FALLÓ');
  exception when others then insert into _r values ('US$ 20 (más de $ 20.000)', sqlerrm); end;
  begin perform public.sacar_saldo_de_pendientes(v_usd, null, 10, 'USD'); insert into _r values ('US$ 10 (menos de $ 20.000)', 'sacado');
  exception when others then insert into _r values ('US$ 10 (menos de $ 20.000)', sqlerrm); end;
  begin perform public.sacar_saldo_de_pendientes(null, v_fc, 950, 'ARS'); insert into _r values ('compra $ 950', 'sacado');
  exception when others then insert into _r values ('compra $ 950', sqlerrm); end;
  perform set_config('request.jwt.claims', json_build_object('sub', (select id from profiles where role = 'vendedor' limit 1), 'role', 'authenticated')::text, true);
  begin perform public.sacar_saldo_de_pendientes(null, v_fc, 500, 'ARS'); insert into _r values ('vendedor', 'NO FALLÓ');
  exception when others then insert into _r values ('vendedor', sqlerrm); end;
  perform set_config('request.jwt.claims', json_build_object('sub', (select id from profiles where email = 'augusto@lazzari.com.ar'), 'role', 'authenticated')::text, true);
end $$;
select 'controles' q, caso, resultado from _r;

select 'volver' q, public.volver_saldo_a_pendientes(
  (select f.id from facturas f join clientes c on c.id = f.cliente_id where c.cuit = '30999034515' and f.tipo = 'FB' and f.punto_venta = 16 and f.numero = 2), null) r;
select 'activos_despues' q, count(*) filter (where not anulado) activos, count(*) filter (where anulado) anulados from saldos_fuera_de_pendientes;
select 'saldo_igual' q, f.estado::text, f.total from facturas f join clientes c on c.id = f.cliente_id
where c.cuit = '30999034515' and f.tipo = 'FB' and f.punto_venta = 16 and f.numero = 2;
