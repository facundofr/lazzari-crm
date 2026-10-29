-- Vuelta atrás de 20261028240000: vuelve el gasto, el pago deja de estar anulado y la línea del banco queda cruzada con él otra vez.
begin;
insert into public.gastos_manuales (id, sociedad_id, fecha, descripcion, proveedor_id, categoria, monto, moneda, notas, created_by, created_at, tipo_gasto, comprobante_url, medio_pago, tipo_recurrencia, gasto_fijo_id, grupo)
values ('8a9fd4d3-f421-4324-a035-b70d9044af96', 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021', date '2026-09-22', 'Mercadería importada (costo) — pago a Gaspar Federico Ovando', null, 'Importaciones', 2680080, 'ARS',
  'Transferencia BBVA Móvil a GASPAR FEDERICO OVANDO (CUIT 20-38935097-5), CBU 0000003100022430511158, ref 50121921011260922, motivo FACTURA. "Pago x importación" (Augusto 17/10/2026). [banco6-17/10]',
  null, '2026-10-17T16:57:38.51829+00:00', 'general', null, 'transferencia', 'eventual', null, 'Operativos')
on conflict (id) do nothing;
update public.movimientos set anulado = false, monto = 2680080, monto_original = null, anulado_at = null, anulado_por = null, conciliado = true, conciliado_at = '2026-10-17T16:57:38.51829+00:00',
  descripcion = 'Gasto — Importaciones — Mercadería importada (costo) — pago a Gaspar Federico Ovando', gasto_manual_id = '8a9fd4d3-f421-4324-a035-b70d9044af96'
where id = 'c338e6df-80d7-4c04-9f4c-6fe0c4c97a92';
update public.extracto_movimientos set estado = 'matcheado', match_movimiento_id = 'c338e6df-80d7-4c04-9f4c-6fe0c4c97a92' where id = '0ffb1b73-7941-4654-a489-0871bd69b5ea';
update public.extractos_bancarios set estado = 'conciliado'::public.extracto_estado where id = 'cafa5135-7118-45f6-b11f-98c3b856b62b' and not exists (select 1 from public.extracto_movimientos x where x.extracto_id = 'cafa5135-7118-45f6-b11f-98c3b856b62b' and x.estado = 'pendiente');
commit;
