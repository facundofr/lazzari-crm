-- Del Sol Constructora (Lazzari): cobro de la OP (remesa) 0001-00018368 del 04/09/2026, con OK de Augusto (19/10/2026).
-- Paga las FC A 0009-00000405 ($ 7.394.812,15) y 0009-00000406 ($ 4.600.666,31) del sistema anterior:
-- eCheq 3644 Galicia $ 11.801.686,09 (en cartera, pago 30/10) + Retención de Ganancias $ 193.792,37 (certificado 11426).
-- Cobro del sistema anterior: sin factura del CRM (no toca la cuenta corriente). Va solo en esta transacción = 1 recibo.
-- Solo agrega 2 movimientos, ata el eCheq y completa su nota; vuelta atrás en supabase/rollback/.
begin;

insert into public.movimientos (id, sociedad_id, cliente_id, tipo, monto, moneda, fecha, conciliado, descripcion) values
  ('c4fbf826-1329-479f-a7d2-085e0f6f015b', 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021', '0f389afe-b826-427e-93fd-ff27bd24f78a',
   'cheque_recibido', 11801686.09, 'ARS', '2026-09-04', false,
   'Cobro — DEL SOL CONSTRUCTORA S.A. — OP: 0001-00018368 | eCheq 3644 Banco Galicia (pago 30/10/2026) — FC A 0009-00000405 $7.394.812,15 + FC A 0009-00000406 $4.600.666,31 (sistema anterior) [delsol-19/10]'),
  ('81a748de-6c3e-4708-bddb-cd7905e1433f', 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021', '0f389afe-b826-427e-93fd-ff27bd24f78a',
   'retencion_ganancias', 193792.37, 'ARS', '2026-09-04', false,
   'Retención de Ganancias — OP: 0001-00018368 | Cert: 11426 | Régimen 078 — FC A 0009-00000405 + FC A 0009-00000406 (sistema anterior) [delsol-19/10]');

-- Como los demás cheques de Del Sol: sin cuenta (el trigger de cuenta sugerida lo pone en cartera).
update public.movimientos set cuenta_id = null where id = 'c4fbf826-1329-479f-a7d2-085e0f6f015b';

update public.echeqs
   set movimiento_id = 'c4fbf826-1329-479f-a7d2-085e0f6f015b',
       observaciones = 'Paga FC-A 0009-00000405 ($7.394.812,15) y 0009-00000406 ($4.600.666,31) del sistema anterior (total $11.995.478,46). OP 0001-00018368 del 04/09/2026: Retención de Ganancias $193.792,37, certificado 11426 [delsol-19/10]'
 where id = 'f61d3e1b-7d65-415f-a379-63d2300bf4a6' and movimiento_id is null;

commit;
