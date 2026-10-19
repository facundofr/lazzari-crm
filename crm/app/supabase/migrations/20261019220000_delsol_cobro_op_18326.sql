-- Del Sol Constructora (Lazzari): cobro de la OP (remesa) 0001-00018326 del 28/08/2026, con OK de Augusto (19/10/2026).
-- Paga la FC A 0009-00000399 ($ 1.370.733,34) del sistema anterior: eCheq 3587 Galicia $ 1.348.076,59 (endosado a
-- BRUNO FRANCIONE el 15/09) + Retención de Ganancias $ 22.656,75 (certificado 11394).
-- Cobro del sistema anterior: sin factura del CRM (no toca la cuenta corriente). Va solo en esta transacción = 1 recibo.
-- Solo agrega 2 movimientos y ata el eCheq; vuelta atrás en supabase/rollback/.
begin;

insert into public.movimientos (id, sociedad_id, cliente_id, tipo, monto, moneda, fecha, conciliado, descripcion) values
  ('a372f7fb-8e17-46f4-b97e-ebc0b79d3bec', 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021', '0f389afe-b826-427e-93fd-ff27bd24f78a',
   'cheque_recibido', 1348076.59, 'ARS', '2026-08-28', false,
   'Cobro — DEL SOL CONSTRUCTORA S.A. — OP: 0001-00018326 | eCheq 3587 Banco Galicia (pago 30/10/2026), endosado a BRUNO FRANCIONE el 15/09/2026 — FC A 0009-00000399 $1.370.733,34 (sistema anterior) [delsol-19/10]'),
  ('b3b9e4d9-2bda-4e05-b6b6-3d354f95c5c9', 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021', '0f389afe-b826-427e-93fd-ff27bd24f78a',
   'retencion_ganancias', 22656.75, 'ARS', '2026-08-28', false,
   'Retención de Ganancias — OP: 0001-00018326 | Cert: 11394 | Régimen 078 — FC A 0009-00000399 (sistema anterior) [delsol-19/10]');

-- Como los demás cheques de Del Sol: sin cuenta (el trigger de cuenta sugerida lo pone en cartera).
update public.movimientos set cuenta_id = null where id = 'a372f7fb-8e17-46f4-b97e-ebc0b79d3bec';

update public.echeqs set movimiento_id = 'a372f7fb-8e17-46f4-b97e-ebc0b79d3bec'
 where id = '436e0a87-0b5f-462e-b9b1-48b95e9a0d67' and movimiento_id is null;

commit;
