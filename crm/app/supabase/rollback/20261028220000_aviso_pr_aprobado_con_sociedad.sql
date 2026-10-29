-- Vuelta atrás de 20261028220000_aviso_pr_aprobado_con_sociedad.sql: deja presupuesto_estado_alert() exactamente como
-- estaba el 28/10/2026 (avisos sin sociedad e importe "$6500.80"). No toca datos.
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
      INSERT INTO public.alertas (tipo, title, description, entity_id, entity_type, module, user_id)
      VALUES (
        'seguimiento',
        'PR aprobado: ' || NEW.numero,
        'El presupuesto ' || NEW.numero || ' fue aprobado por $' || NEW.total,
        NEW.id, 'presupuestos', 'presupuestos', NEW.created_by
      );
    -- Alert on rejection
    ELSIF NEW.estado = 'rechazado' THEN
      INSERT INTO public.alertas (tipo, title, description, entity_id, entity_type, module, user_id)
      VALUES (
        'seguimiento',
        'PR rechazado: ' || NEW.numero,
        'Motivo: ' || COALESCE(NEW.motivo_rechazo, 'Sin motivo especificado'),
        NEW.id, 'presupuestos', 'presupuestos', NEW.created_by
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

commit;
