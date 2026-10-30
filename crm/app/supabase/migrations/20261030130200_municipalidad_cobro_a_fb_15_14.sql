-- Auditoría de la plata (30/10/2026, Tanda A punto 7, F8): Municipalidad de Pergamino. La FB 0015-00000006 ($ 59.500,24) se cobró el
-- 17/09 y el 22/10 se anuló con la NCB 0015-00000005; la que la reemplaza es la FB 0015-00000014 (mismo importe), que figuraba impaga
-- (se le podía volver a reclamar) mientras la NC guardaba esos $ 59.500,24 "a favor" sin que ninguna pantalla pudiera aplicarlos.
-- Arreglo: el cobro del 17/09 pasa a pagar la FB 15-14 (queda "pagada") y la NC queda aplicada a la FB 15-6, como si se hubiera
-- emitido con la factura impaga: crédito aplicado 59.500,24 y sin saldo a favor. La cuenta del cliente sigue en 0. Nada de ARCA cambia
-- (CAE, importes y estados de la FB 15-6 y la NC quedan iguales).
-- Vuelta atrás: supabase/rollback/20261030130200_municipalidad_cobro_a_fb_15_14.sql
begin;

update public.movimientos
   set factura_id = '02d33850-6995-47ee-9e00-fbaa9f0116cc',
       descripcion = descripcion || ' — aplicado a la FB 0015-00000014, que reemplaza a la FB 15-6 anulada con la NCB 15-5 (auditoría de la plata 30/10/2026)'
 where id = '1ff7d346-6901-45c8-a964-dba81fb88ac2' and factura_id = 'b53674df-9061-4ccc-b53a-2d430e159687' and not coalesce(anulado, false);

update public.facturas set credito_aplicado = 59500.24, saldo_a_favor_cliente = 0
 where id = 'c21a24b1-4c23-43fd-b926-932c0474716a' and saldo_a_favor_cliente = 59500.24;
update public.facturas set total_acreditado = 59500.24
 where id = 'b53674df-9061-4ccc-b53a-2d430e159687' and coalesce(total_acreditado, 0) = 0;

select public.lz_estado_factura_por_cobro('02d33850-6995-47ee-9e00-fbaa9f0116cc'::uuid);

commit;
