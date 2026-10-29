-- Prueba de 20261029120000 (la corre migrar.cjs --probar y deshace TODO; no habla con ARCA): simula un intento autorizado,
-- registra la factura dos veces con la misma clave (la segunda devuelve la misma) y mira renglones y PR.
select set_config('request.jwt.claims', json_build_object('sub', (select id from public.profiles where role::text='super_admin' and coalesce(active,true) limit 1), 'role','authenticated')::text, true);
insert into public.fiscal_emission_attempts (sociedad_id, request_key, payload_hash, request_payload, punto_venta, user_id, state, http_status, response)
values ('eee2a3c8-fe6c-494d-bd2f-7a5d8067d021', '99999999-9999-4999-8999-999999999999', repeat('a', 64), '{}'::jsonb, 9999,
        (select id from public.profiles where role::text='super_admin' and coalesce(active,true) limit 1), 'authorized', 200, '{"prueba":true}'::jsonb);
create temp table _p as select '{"tipo":"FA","punto_venta":9999,"numero":99999999,"cliente_id":"e5c58c50-a375-4bcf-93fd-22daff081327","presupuesto_id":"ee8b6572-e731-45b8-bbb6-9d895e997293","fecha":"2026-10-29","cae":"12345678901234","cae_vencimiento":"2026-11-08","subtotal":1000,"iva":210,"total":1210,"moneda":"ARS"}'::jsonb f,
  '[{"descripcion":"PRUEBA renglón 1","cantidad":2,"precio_unitario":300,"iva_porcentaje":21},{"descripcion":"PRUEBA renglón 2","cantidad":1,"precio_unitario":400,"iva_porcentaje":21}]'::jsonb i;
select 'primera' paso, public.registrar_factura_venta_autorizada('eee2a3c8-fe6c-494d-bd2f-7a5d8067d021', '99999999-9999-4999-8999-999999999999', (select f from _p), (select i from _p))->>'replayed' replayed;
select 'segunda' paso, public.registrar_factura_venta_autorizada('eee2a3c8-fe6c-494d-bd2f-7a5d8067d021', '99999999-9999-4999-8999-999999999999', (select f from _p), (select i from _p))->>'replayed' replayed;
select 'resultado' paso, (select count(*) from public.facturas where punto_venta = 9999 and numero = 99999999) facturas,
  (select count(*) from public.factura_items fi join public.facturas f on f.id = fi.factura_id where f.punto_venta = 9999 and f.numero = 99999999) renglones,
  (select estado::text from public.presupuestos where id = 'ee8b6572-e731-45b8-bbb6-9d895e997293') pr_estado;
