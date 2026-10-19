-- Del Sol Constructora (Lazzari): anula el saldo a favor de $ 1.242.839,98 (pago de la FA 0015-00000039 anulada, remesa 17009).
-- Augusto (19/10/2026): "Si, anulalo." La cuenta corriente queda en lo que deben las FA 15-65, 67 y 68.
-- Se anula como la app (anulado + monto_original), no se borra; vuelta atrás en supabase/rollback/.
begin;
update public.movimientos
   set anulado = true,
       monto_original = monto,
       monto = 0,
       anulado_at = now(),
       descripcion = '[ANULADO · Augusto 19/10: sin saldo a favor] ' || descripcion
 where id = 'ff39ab9f-80fa-4eed-be82-044c3564b527' and not coalesce(anulado, false);
commit;
