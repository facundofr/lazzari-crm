-- Forma de cobro "Link de pago" (Mercado Pago) (Augusto 20/10/2026: "Agrega como forma de cobro 'link de pago'").
-- SOLO AGREGA: un valor nuevo en el tipo de movimiento y lo suma a la regla de "qué va en un recibo".
-- No cambia ni borra ningún movimiento. Sin cuenta: el trigger de cuentas no le asigna ninguna (no hay cuenta de Mercado Pago).
-- Vuelta atrás: supabase/rollback/20261020180000_cobro_link_de_pago.sql
alter type public.movimiento_tipo add value if not exists 'link_pago';

-- ¿Este movimiento va en un recibo? (igual que en 20261019210000, + 'link_pago')
create or replace function public.es_movimiento_de_recibo(m public.movimientos) returns boolean
language sql immutable as $$
  select m.cliente_id is not null and m.proveedor_id is null and m.nota_credito_compra_id is null
    and m.tipo::text in ('cobro','transferencia','efectivo','tarjeta','link_pago','cheque_recibido','echeq','deposito',
                         'retencion_iva','retencion_ganancias','retencion_iibb','retencion_suss')
    and coalesce(m.descripcion, '') !~* '^\s*\[Ajuste manual\]';
$$;
