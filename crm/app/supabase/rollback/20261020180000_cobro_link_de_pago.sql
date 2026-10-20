-- Vuelta atrás de 20261020180000_cobro_link_de_pago.sql.
-- El valor 'link_pago' no se puede sacar del tipo de movimiento (queda sin usar, no molesta).
-- Los cobros con link de pago pasan a "Tarjeta" (el monto, la factura y el recibo quedan igual).
begin;
update public.movimientos set tipo = 'tarjeta' where tipo::text = 'link_pago';
create or replace function public.es_movimiento_de_recibo(m public.movimientos) returns boolean
language sql immutable as $$
  select m.cliente_id is not null and m.proveedor_id is null and m.nota_credito_compra_id is null
    and m.tipo::text in ('cobro','transferencia','efectivo','tarjeta','cheque_recibido','echeq','deposito',
                         'retencion_iva','retencion_ganancias','retencion_iibb','retencion_suss')
    and coalesce(m.descripcion, '') !~* '^\s*\[Ajuste manual\]';
$$;
commit;
