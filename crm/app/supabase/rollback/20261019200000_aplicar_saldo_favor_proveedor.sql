-- Vuelta atrás de 20261019200000_aplicar_saldo_favor_proveedor.sql: saca solo la función.
-- Lo que ya se aplicó con ella queda como está (son vínculos OP ↔ factura válidos, iguales a los de una OP normal).
drop function if exists public.aplicar_saldo_favor_proveedor(uuid, uuid, jsonb);
