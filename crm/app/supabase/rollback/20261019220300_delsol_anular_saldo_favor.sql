-- Vuelta atrás de 20261019220300_delsol_anular_saldo_favor.sql: vuelve a dejar el saldo a favor de Del Sol activo.
begin;
update public.movimientos
   set anulado = false,
       monto = monto_original,
       monto_original = null,
       anulado_at = null,
       descripcion = replace(descripcion, '[ANULADO · Augusto 19/10: sin saldo a favor] ', '')
 where id = 'ff39ab9f-80fa-4eed-be82-044c3564b527' and anulado;
commit;
