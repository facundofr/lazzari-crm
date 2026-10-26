-- Vuelta atrás de 20261026160000_aplicar_saldo_favor_cliente.sql: saca la función.
-- Los saldos a favor que ya se aplicaron quedan aplicados (son datos, no se tocan).
drop function if exists public.aplicar_saldo_favor_cliente(uuid, uuid, jsonb);
