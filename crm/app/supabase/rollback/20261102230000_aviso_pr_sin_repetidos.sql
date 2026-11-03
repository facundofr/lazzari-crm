-- Vuelta atrás de 20261102230000_aviso_pr_sin_repetidos.sql: deja presupuesto_estado_alert() exactamente como
-- estaba el 02/11/2026 (definición de 20261028220000: un aviso cada vez, también a quien hizo el cambio). No toca datos.
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
