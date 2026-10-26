-- Vuelta atrás de 20261026120000_anular_pago_doble_serenplas.sql
-- Vuelve a dejar activos el pago y la retención del 15/09 de SERENPLAS (OP-000014, carga vieja sin la OP atada).
begin;

update public.movimientos set anulado = false, anulado_at = null, anulado_por = null
  where id in ('1037a979-f842-4524-9ccf-33e1c2bfc34a', '44942db9-d8f4-4605-900b-6440fc9ae48f')
    and anulado;

commit;
