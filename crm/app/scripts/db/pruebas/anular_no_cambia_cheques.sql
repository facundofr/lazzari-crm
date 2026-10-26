-- Prueba de 20261026180000_anular_no_cambia_cheques.sql (se corre con --probar: al final se deshace todo).
-- Simula a Augusto. (1) Anula la OP-000087 (9 cheques propios entregados a Prisina): los cheques tienen que quedar igual.
-- (2) Anula el cobro del cheque 233 de Punto Espacios (en cartera): el cheque tiene que seguir en cartera y salir el aviso.
select set_config('request.jwt.claims', '{"sub":"cb8fdf3e-d171-4042-9da7-248fe863b96d","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', 'cb8fdf3e-d171-4042-9da7-248fe863b96d', true);

select 'antes OP' as paso, e.estado, e.destino_nombre, count(*) from public.echeqs e
 join public.ordenes_pago op on op.created_at = e.created_at and op.sociedad_id = e.sociedad_id and op.id = '134d4372-b047-4ec9-8bc7-b7619f8a9fd6'
 where e.direccion = 'emitido' group by 1, 2, 3;
select public.anular_orden_pago_segura('134d4372-b047-4ec9-8bc7-b7619f8a9fd6', 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021')::text as resultado_op;
select 'después OP' as paso, e.estado, e.destino_nombre, count(*) from public.echeqs e
 join public.ordenes_pago op on op.created_at = e.created_at and op.sociedad_id = e.sociedad_id and op.id = '134d4372-b047-4ec9-8bc7-b7619f8a9fd6'
 where e.direccion = 'emitido' group by 1, 2, 3;
select numero, estado from public.ordenes_pago where id = '134d4372-b047-4ec9-8bc7-b7619f8a9fd6';

select 'antes cobro' as paso, numero, estado, movimiento_id from public.echeqs where id = '01a6e971-f50f-4ac7-90eb-7115703769ea';
select public.gestionar_cobro('12c6cf54-0850-4b4e-83b6-ffe9511f97ab', 'anular')::text as resultado_cobro;
select 'después cobro' as paso, numero, estado, movimiento_id from public.echeqs where id = '01a6e971-f50f-4ac7-90eb-7115703769ea';
select anulado, monto from public.movimientos where id = '12c6cf54-0850-4b4e-83b6-ffe9511f97ab';
