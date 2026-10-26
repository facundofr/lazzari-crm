-- Prueba de aplicar_saldo_favor_cliente (se corre con --probar: al final se deshace todo).
-- Simula a Augusto, crea un saldo a favor de prueba de $ 100 para Del Sol y aplica $ 60 a la FA 0015-00000065.
select set_config('request.jwt.claims', '{"sub":"cb8fdf3e-d171-4042-9da7-248fe863b96d","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', 'cb8fdf3e-d171-4042-9da7-248fe863b96d', true);

insert into public.movimientos (id, tipo, cliente_id, descripcion, monto, moneda, fecha, conciliado, sociedad_id, ajuste_sentido)
values ('00000000-0000-0000-0000-00000000f0f0', 'ajuste', '0f389afe-b826-427e-93fd-ff27bd24f78a', 'PRUEBA saldo a favor', 100, 'ARS', current_date, false,
        'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021', 'credito');

select public.aplicar_saldo_favor_cliente(
  'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021', '0f389afe-b826-427e-93fd-ff27bd24f78a',
  '[{"movimiento_id":"00000000-0000-0000-0000-00000000f0f0","factura_id":"365ddfc3-e9aa-4e8f-9b7f-7741f36312ca","monto":60}]'::jsonb
) as resultado_parcial;

-- Esperado: el de prueba queda en 40 sin factura; uno nuevo de 60 atado a la FA 65; la FA 65 queda parcial y debe 253.327,55.
select id, monto, factura_id, ajuste_sentido, descripcion from public.movimientos
 where id = '00000000-0000-0000-0000-00000000f0f0' or descripcion like 'Saldo a favor aplicado a la FA 0015-00000065 (de: PRUEBA%';
select numero, estado, total - coalesce(total_acreditado, 0) - public.lz_cobrado_factura(id) as debe
  from public.facturas where id = '365ddfc3-e9aa-4e8f-9b7f-7741f36312ca';

-- Ahora los 40 que quedan, enteros: el movimiento de prueba queda atado a la factura.
select public.aplicar_saldo_favor_cliente(
  'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021', '0f389afe-b826-427e-93fd-ff27bd24f78a',
  '[{"movimiento_id":"00000000-0000-0000-0000-00000000f0f0","factura_id":"365ddfc3-e9aa-4e8f-9b7f-7741f36312ca","monto":40}]'::jsonb
) as resultado_total;
select id, monto, factura_id from public.movimientos where id = '00000000-0000-0000-0000-00000000f0f0';
