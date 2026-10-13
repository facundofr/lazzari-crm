-- Vuelta atrás de 20261013121000_pr1148_facturado.sql: PR-2026-1148 vuelve a "facturar".
begin;

update public.presupuestos set estado = 'facturar' where numero = 'PR-2026-1148' and estado = 'facturado';

commit;
