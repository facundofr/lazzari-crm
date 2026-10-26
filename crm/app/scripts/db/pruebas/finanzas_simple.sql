-- Prueba de 20261026130000_finanzas_simple.sql (se corre con --probar: muestra resultados y DESHACE todo, también los cambios de prueba).
-- Simula estar logueado como Augusto (las funciones piden permisos de Finanzas).
select set_config('request.jwt.claims', '{"sub":"cb8fdf3e-d171-4042-9da7-248fe863b96d","role":"authenticated"}', true);

create temp table lz_prueba (control text, valor text, nota text) on commit drop;

-- 1) Hoy el banco y el CRM coinciden: no cambia ningún cheque.
insert into lz_prueba select 'cheques que cambiarían hoy', jsonb_array_length(public.actualizar_cheques_segun_banco('eee2a3c8-fe6c-494d-bd2f-7a5d8067d021', true)->'cambios')::text, 'esperado 0';

-- 2) Simulación: el banco dice RECHAZADO del cheque 3881 (en cartera) y PAGADO de un cheque propio entregado.
update public.echeqs set estado_banco = 'RECHAZADO' where id = '4357d387-de1d-459c-9ff0-3c44d8ef0787';
update public.echeqs set estado_banco = 'PAGADO'
  where id = (select id from public.echeqs where sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and direccion = 'emitido' and estado = 'entregado' order by fecha_pago limit 1);
insert into lz_prueba select 'con la simulación, cambiarían (probar)', jsonb_array_length(public.actualizar_cheques_segun_banco('eee2a3c8-fe6c-494d-bd2f-7a5d8067d021', true)->'cambios')::text, 'esperado 2';
insert into lz_prueba select 'probar no cambia nada', estado, 'esperado en_cartera' from public.echeqs where id = '4357d387-de1d-459c-9ff0-3c44d8ef0787';
insert into lz_prueba select 'cambios aplicados', jsonb_array_length(public.actualizar_cheques_segun_banco('eee2a3c8-fe6c-494d-bd2f-7a5d8067d021', false)->'cambios')::text, 'esperado 2';
insert into lz_prueba select 'cheque 3881 (recibido, banco RECHAZADO)', estado, 'esperado rechazado' from public.echeqs where id = '4357d387-de1d-459c-9ff0-3c44d8ef0787';
insert into lz_prueba select 'cobro del cheque 3881', case when m.anulado then 'anulado' else 'activo' end, 'esperado anulado (si tenía cobro)'
  from public.echeqs e join public.movimientos m on m.id = e.movimiento_id where e.id = '4357d387-de1d-459c-9ff0-3c44d8ef0787';
insert into lz_prueba select 'cheque propio (banco PAGADO)', estado, 'esperado cobrado'
  from public.echeqs where sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and direccion = 'emitido' and estado_banco = 'PAGADO' and observaciones is distinct from 'x'
  order by (estado = 'cobrado') limit 1;
insert into lz_prueba select 'segunda corrida (no repite)', jsonb_array_length(public.actualizar_cheques_segun_banco('eee2a3c8-fe6c-494d-bd2f-7a5d8067d021', false)->'cambios')::text, 'esperado 0';

-- 3) Una línea ya confirmada no se vuelve a confirmar con "solo_pendiente".
insert into lz_prueba select 'línea confirmada: salteada',
  (public.aplicar_cruces_extracto('eee2a3c8-fe6c-494d-bd2f-7a5d8067d021', '[{"linea_id":"2d51f7e0-2e69-41e0-80c1-8bb5eb6e794e","clasificacion":"otro","solo_pendiente":true}]'::jsonb)->'salteadas')::text, 'esperado ["2d51f7e0-…"]';
insert into lz_prueba select 'línea confirmada: sigue igual', clasificacion, 'esperado impuesto' from public.extracto_movimientos where id = '2d51f7e0-2e69-41e0-80c1-8bb5eb6e794e';

select * from lz_prueba;
