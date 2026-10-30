-- Vuelta atrás de 20261030130200: el cobro del 17/09 vuelve a la FB 15-6, la NCB 15-5 vuelve a tener $ 59.500,24 a favor y la FB 15-14
-- vuelve a "emitida" (impaga).
begin;
update public.movimientos
   set factura_id = 'b53674df-9061-4ccc-b53a-2d430e159687', descripcion = 'Cobro FB 0015-00000006'
 where id = '1ff7d346-6901-45c8-a964-dba81fb88ac2';
update public.facturas set credito_aplicado = 0, saldo_a_favor_cliente = 59500.24 where id = 'c21a24b1-4c23-43fd-b926-932c0474716a';
update public.facturas set total_acreditado = 0 where id = 'b53674df-9061-4ccc-b53a-2d430e159687';
update public.facturas set estado = 'emitida' where id = '02d33850-6995-47ee-9e00-fbaa9f0116cc';
commit;
