-- Deshace 20261009230000_nc_compra_saldo.sql. Las NC y sus aplicaciones ya registradas NO se borran
-- (siguen siendo movimientos válidos); solo se quitan las funciones nuevas y la tabla de vínculo con OP.
drop function if exists public.registrar_pago_proveedor_con_nc(uuid, uuid, text, uuid, date, text, jsonb, jsonb, numeric, numeric, numeric, numeric, text, boolean, jsonb);
drop function if exists public.anular_nota_credito_compra_v2(uuid, uuid);
drop function if exists public.registrar_nota_credito_compra_v2(uuid, uuid, jsonb, jsonb, jsonb);
drop function if exists public._aplicar_nc_compra(uuid, uuid, uuid, numeric, date, uuid, uuid);
drop function if exists public.nc_compra_disponible(uuid);
drop table if exists public.op_notas_credito_compra;
drop index if exists public.movimientos_nc_request_key_idx;
alter table public.movimientos drop column if exists nc_request_key;
