-- Deshace la carga de la NC A 0001-00000025 de BARRAZA (cargada el 20/10/2026 con nc-barraza-0001-25.cjs).
-- Solo si Augusto lo pide. Correr en el SQL Editor de Supabase.
begin;
delete from public.nota_credito_venta_aplicaciones where nota_credito_id = '25e5e945-2cbb-4d0f-8442-fc323289567d';
delete from public.factura_items where factura_id = '25e5e945-2cbb-4d0f-8442-fc323289567d';
delete from public.facturas where id = '25e5e945-2cbb-4d0f-8442-fc323289567d';
-- Las facturas vuelven a como estaban antes de la NC.
update public.facturas set total_acreditado = 0, estado = 'emitida' where id in ('d14caf46-c725-447d-aa93-08087b3ea0ad', '9d70418b-17ee-4760-8697-9c700d4075cc'); -- FA 15-10 y 15-30
-- FA 15-19 no cambió (siguió 'pagada', total_acreditado 0).
commit;
