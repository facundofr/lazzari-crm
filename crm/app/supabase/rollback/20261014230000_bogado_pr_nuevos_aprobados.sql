-- Vuelta atrás de 20261014230000_bogado_pr_nuevos_aprobados.sql: los 2 PR vuelven a Pendiente.
begin;
update public.presupuestos set estado = 'pendiente', respondido_at = null where numero in ('PR-2026-1253', 'PR-2026-1254');
commit;
