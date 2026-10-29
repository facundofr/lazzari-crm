-- Avisos de "PR aprobado" / "PR rechazado" con la sociedad del PR (auditoría integral 28/10/2026, Tanda 7, H40).
-- Antes el trigger presupuesto_estado_alert los creaba sin sociedad_id: en la campana salían en las dos sociedades y en el
-- tablero (que filtra por sociedad) no salían nunca. Además el importe salía "$6500.80" aunque el PR fuera en US$.
-- Ahora: sociedad_id del PR y el importe con su moneda y en formato argentino ("US$ 6.500,80").
-- No toca datos: los avisos viejos quedan como están (Augusto). Solo cambia la función del trigger (mismo trigger y permisos).
-- Prueba: scripts/db/pruebas/aviso_pr_aprobado.sql
-- Vuelta atrás: supabase/rollback/20261028220000_aviso_pr_aprobado_con_sociedad.sql
begin;

CREATE OR REPLACE FUNCTION public.presupuesto_estado_alert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF OLD.estado IS DISTINCT FROM NEW.estado THEN
    -- Alert on approval
    IF NEW.estado = 'aprobado' THEN
      INSERT INTO public.alertas (tipo, title, description, entity_id, entity_type, module, user_id, sociedad_id)
      VALUES (
        'seguimiento',
        'PR aprobado: ' || NEW.numero,
        'El presupuesto ' || NEW.numero || ' fue aprobado por '
          || CASE WHEN NEW.moneda::text = 'USD' THEN 'US$ ' ELSE '$ ' END
          || translate(to_char(coalesce(NEW.total, 0), 'FM999,999,999,990.00'), ',.', '.,'),
        NEW.id, 'presupuestos', 'presupuestos', NEW.created_by, NEW.sociedad_id
      );
    -- Alert on rejection
    ELSIF NEW.estado = 'rechazado' THEN
      INSERT INTO public.alertas (tipo, title, description, entity_id, entity_type, module, user_id, sociedad_id)
      VALUES (
        'seguimiento',
        'PR rechazado: ' || NEW.numero,
        'Motivo: ' || COALESCE(NEW.motivo_rechazo, 'Sin motivo especificado'),
        NEW.id, 'presupuestos', 'presupuestos', NEW.created_by, NEW.sociedad_id
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

commit;
