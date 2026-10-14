-- Prueba de 20261013220000_pago_tarjeta_factura_compra.sql (todo se deshace): simula a un vendedor.
-- 1) lista tarjetas; 2) intenta pagar una factura que ya está pagada (no duplica); 3) paga Segutécnica (pendiente) y mira el resultado.
select set_config('request.jwt.claims', json_build_object('sub', (select id from profiles where full_name = 'Jeronimo'), 'role', 'authenticated')::text, true);
set local role authenticated;
select 'tarjetas' as paso, t.nombre::text as dato from public.tarjetas_de_sociedad('eee2a3c8-fe6c-494d-bd2f-7a5d8067d021') t
union all
select 'ya pagada (Fravega)', public.registrar_pago_tarjeta_factura_compra(
  (select id from facturas_compra where numero_factura = '0001-00000398' and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021'),
  'f2caa8a4-594a-4055-aea4-f2a58e953b25')::text
union all
select 'pendiente (Segutécnica, se deshace)', public.registrar_pago_tarjeta_factura_compra(
  (select id from facturas_compra where numero_factura = '0014-00073272' and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021'),
  'f2caa8a4-594a-4055-aea4-f2a58e953b25')::text
union all
select 'Master con vendedor (tiene que fallar)', (select case when exists (select 1 from public.tarjetas_de_sociedad('eee2a3c8-fe6c-494d-bd2f-7a5d8067d021') t where t.nombre ilike '%master%') then 'LA VE (mal)' else 'no la ve (bien)' end);
