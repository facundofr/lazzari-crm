-- Prueba de 20261030192000_banco_simple.sql (con --probar: siempre se deshace). Usa 3 líneas pendientes reales del 26/10:
-- IVA del banco ($ 669,90 → del banco), OP-000091 García ($ 91.500 → cruzada con su pago) y el depósito del cheque de Bichara
-- ($ 290.000 → cruzada con el cheque). Procesa, mira, deshace y vuelve a mirar.
select set_config('request.jwt.claims', json_build_object('sub', (select id from public.profiles where email = 'augusto@lazzari.com.ar'), 'role', 'authenticated')::text, true);

create temp table _l as
select (select e.id from extracto_movimientos e where e.estado = 'pendiente' and e.monto = 669.90 and e.fecha = '2026-10-26') iva,
       (select e.id from extracto_movimientos e where e.estado = 'pendiente' and e.monto = 91500 and e.fecha = '2026-10-26') op,
       (select e.id from extracto_movimientos e where e.estado = 'pendiente' and e.monto = 290000 and e.fecha = '2026-10-26') dep,
       (select m.id from movimientos m join ordenes_pago o on o.id = m.orden_pago_id where o.numero = 'OP-000091' and m.tipo = 'pago' and not coalesce(m.anulado, false) limit 1) mov,
       (select c.id from echeqs c where c.numero like '%85983561' limit 1) cheque,
       (select e.id from extracto_movimientos e where e.estado = 'matcheado' limit 1) ya,
       (select e.id from extracto_movimientos e where e.estado = 'pendiente' and e.monto = 2420 and e.fecha = '2026-10-26') sirc;

select 'antes' q, (select conciliado from movimientos where id = _l.mov) mov_conciliado, (select estado from echeqs where id = _l.cheque) cheque_estado from _l;

create temp table _r as
select public.procesar_banco('eee2a3c8-fe6c-494d-bd2f-7a5d8067d021', jsonb_build_array(
  jsonb_build_object('linea_id', iva, 'estado', 'del_banco', 'clasificacion', 'impuesto', 'subtipo', 'iva', 'movimientos', '[]'::jsonb, 'motivo', 'IVA del banco'),
  jsonb_build_object('linea_id', op, 'estado', 'cruzada', 'clasificacion', 'pago', 'movimientos', jsonb_build_array(mov), 'motivo', 'Importe exacto'),
  jsonb_build_object('linea_id', dep, 'estado', 'cruzada', 'clasificacion', 'cheque_acreditado', 'cheque_id', cheque, 'movimientos', '[]'::jsonb, 'motivo', 'Depósito del cheque'),
  jsonb_build_object('linea_id', ya, 'estado', 'del_banco', 'clasificacion', 'impuesto', 'subtipo', 'iva', 'motivo', 'ya resuelta: se saltea'),
  jsonb_build_object('linea_id', iva, 'estado', 'sin_cruzar', 'motivo', 'sin cruzar: no se aplica'),
  jsonb_build_object('linea_id', sirc, 'estado', 'sin_cruzar', 'motivo', 'prueba', 'aviso', 'Prueba del aviso a la campana (se deshace)')
)) r from _l;
select 'procesar' q, r->>'aplicadas' aplicadas, r->>'salteadas' salteadas, r->'avisos' avisos from _r;

-- El aviso queda una sola vez en la campana: la segunda vez no se repite. La línea sigue pendiente.
select 'alerta' q, count(*) n, max(a.title) titulo, max(a.module) modulo from alertas a, _l where a.entity_type = 'extracto_movimiento' and a.entity_id = _l.sirc;
select 'aviso_otra_vez' q, public.procesar_banco('eee2a3c8-fe6c-494d-bd2f-7a5d8067d021', jsonb_build_array(
  jsonb_build_object('linea_id', sirc, 'estado', 'sin_cruzar', 'aviso', 'Prueba del aviso a la campana (se deshace)')))->'avisos' avisos from _l;
select 'alerta_sigue_una' q, count(*) n, (select estado from extracto_movimientos where id = _l.sirc) linea from alertas a, _l
 where a.entity_type = 'extracto_movimiento' and a.entity_id = _l.sirc group by _l.sirc;

select 'despues' q, e.monto, e.estado, e.clasificacion, e.subtipo, e.match_movimiento_id is not null con_mov, e.cheque_id is not null con_cheque, left(e.nota, 30) nota
  from extracto_movimientos e, _l where e.id in (_l.iva, _l.op, _l.dep) order by e.monto;
select 'despues_mov' q, m.conciliado, m.extracto_movimiento_id = _l.op dos_lados from movimientos m, _l where m.id = _l.mov;
select 'despues_cheque' q, c.estado, c.fecha_deposito from echeqs c, _l where c.id = _l.cheque;
select 'registro' q, accion, origen, tipo, propuesta->>'estado' estado from finanzas_registro where propuesta->>'carga' = (select r->>'carga' from _r) order by tipo;

select 'deshacer' q, public.deshacer_banco('eee2a3c8-fe6c-494d-bd2f-7a5d8067d021', (select (r->>'carga')::uuid from _r), null) r;

select 'deshecho' q, e.monto, e.estado, e.clasificacion, e.match_movimiento_id, e.cheque_id from extracto_movimientos e, _l where e.id in (_l.iva, _l.op, _l.dep) order by e.monto;
select 'deshecho_mov' q, m.conciliado, m.extracto_movimiento_id from movimientos m, _l where m.id = _l.mov;
select 'deshecho_cheque' q, c.estado, c.fecha_deposito from echeqs c, _l where c.id = _l.cheque;
select 'desatadas' q, count(*) from finanzas_registro where accion = 'desatada' and propuesta->>'carga' = (select r->>'carga' from _r);
