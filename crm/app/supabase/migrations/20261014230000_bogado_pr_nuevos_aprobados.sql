-- Bogado (14/10/2026, OK de Augusto): PR-2026-1253 y PR-2026-1254 pasan a Aprobado para facturarse desde Ventas.
-- Se hace acá y no por pantalla porque aprobar por pantalla genera OC nuevas y ya tienen las suyas (migración 20261014220000).
begin;
update public.presupuestos set estado = 'aprobado', respondido_at = now()
 where numero in ('PR-2026-1253', 'PR-2026-1254') and estado = 'pendiente' and eliminado = false;
do $$ begin
  if (select count(*) from public.presupuestos where numero in ('PR-2026-1253', 'PR-2026-1254') and estado = 'aprobado') <> 2 then
    raise exception 'No quedaron los 2 PR en aprobado';
  end if;
end $$;
commit;
