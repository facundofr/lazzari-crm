-- PR-2026-1148 quedó en "facturar" aunque ya tiene la FA 0016-00000009 emitida — 13/10/2026, con OK de Augusto.
-- (PR-2026-1062 NO se toca: su FCE fue anulada por NC y queda para volver a facturar.)
-- Vuelta atrás: supabase/rollback/20261013121000_pr1148_facturado.sql
begin;

update public.presupuestos set estado = 'facturado'
where numero = 'PR-2026-1148' and estado = 'facturar'
  and exists (select 1 from public.facturas f where f.presupuesto_id = presupuestos.id and f.tipo = 'FA' and f.estado = 'emitida');

commit;
