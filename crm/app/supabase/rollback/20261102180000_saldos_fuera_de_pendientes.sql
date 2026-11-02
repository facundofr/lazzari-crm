-- Vuelta atrás de 20261102180000_saldos_fuera_de_pendientes.sql: saca «Sacar de pendientes» de Cobrar y Pagar.
-- Se pierden las marcas (esos saldos vuelven a aparecer como pendientes). No toca facturas, cobros, pagos ni saldos.
begin;
drop function if exists public.sacar_saldo_de_pendientes(uuid, uuid, numeric, text);
drop function if exists public.volver_saldo_a_pendientes(uuid, uuid);
drop table if exists public.saldos_fuera_de_pendientes;
commit;
