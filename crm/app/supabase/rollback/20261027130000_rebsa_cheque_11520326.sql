-- Vuelta atrás de 20261027130000_rebsa_cheque_11520326.sql
-- El segundo cheque de Rebsa vuelve a como se cargó el 27/10: N° 11520327 y pago el 07/11/2026.
begin;

update public.echeqs set numero = '11520327', fecha_pago = '2026-11-07'
  where id = '0c48b49d-dc42-4ada-8f81-dd855cc55b44' and numero = '11520326' and fecha_pago = '2026-11-23';

commit;
