-- Prueba de 20261026190000_op_cheque_de_op_anulada.sql (se corre con --probar: al final se deshace todo).
-- Simula a Augusto: anula la OP-000088 (Rafada, eCheq propio 90017406 creado por la OP) y la vuelve a hacer con el MISMO cheque
-- (como si cargara el comprobante "eCheq Emitido"). Esperado: el cheque no se mueve al anular; la OP nueva se guarda usando ese
-- cheque (no se crea otro 90017406); usarlo una tercera vez falla porque ya está en una OP vigente.
select set_config('request.jwt.claims', '{"sub":"cb8fdf3e-d171-4042-9da7-248fe863b96d","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', 'cb8fdf3e-d171-4042-9da7-248fe863b96d', true);

select public.anular_orden_pago_segura('7d161067-848a-4e89-b400-e2d2064ec869', 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021')::text as anular;
select 'después de anular' as paso, numero, estado, destino_nombre,
  public.lz_cheque_libre_para_op(id, sociedad_id, '9ea70aae-5712-4e1e-8e7c-accdb8b238f2', null) as libre_rafada,
  public.lz_cheque_libre_para_op(id, sociedad_id, '00000000-0000-0000-0000-000000000000', null) as libre_otro
from public.echeqs where id = '8e78285c-5528-4ac0-8f6c-144c2b2b5bf5';

select public.registrar_pago_proveedor_seguro(
  'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021', '00000000-0000-0000-0000-0000000a0a01', 'op', '9ea70aae-5712-4e1e-8e7c-accdb8b238f2',
  '2026-10-23', 'ARS', '[{"id":"3f4cebeb-b40e-4d23-8aba-e9c199f6a725","monto":261481}]'::jsonb,
  '[{"tipo":"cheque_propio","banco":"BBVA","fecha":"2026-11-21","monto":261480,"moneda":"ARS","echeq_id":"8e78285c-5528-4ac0-8f6c-144c2b2b5bf5","cotizacion":1,"fecha_cobro":"2026-11-21","tipo_cheque":"echeq","fecha_emision":"2026-10-23","numero_cheque":"90017406","beneficiario_cuit":"30715508423","beneficiario_nombre":"Rafada S.A."}]'::jsonb,
  261481, 216100, 0, 0, 'PRUEBA', false)::text as op_nueva;

select 'después de la OP nueva' as paso, numero, estado, destino_nombre,
  public.lz_cheque_libre_para_op(id, sociedad_id, '9ea70aae-5712-4e1e-8e7c-accdb8b238f2', null) as libre_rafada
from public.echeqs where id = '8e78285c-5528-4ac0-8f6c-144c2b2b5bf5';
select count(*) as cheques_90017406 from public.echeqs where numero = '90017406' and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021';
select numero, estado, neto_a_pagar from public.ordenes_pago where notas = 'PRUEBA' and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021';
