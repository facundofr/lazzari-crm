-- Avisos "PR aprobado" / "PR rechazado" sin repetidos (auditoría 02/11/2026, P01).
-- Antes el trigger presupuesto_estado_alert creaba un aviso CADA vez que el PR entraba en aprobado o rechazado
-- ("PR aprobado: PR-2026-1034" 13 veces el mismo día) y se lo mandaba a created_by aunque fuera quien lo aprobó.
-- Ahora:
--   · no crea el aviso si esa persona ya tiene uno SIN LEER del mismo PR con el mismo título (si ya lo leyó, sí sale de nuevo);
--   · no se lo manda a quien hizo el cambio (auth.uid() = created_by: ya lo sabe). Si el cambio lo hace el sistema
--     (cron, sin usuario), el aviso sale igual;
--   · sigue con la sociedad del PR y el importe con su moneda en formato argentino (igual que 20261028220000).
-- No toca datos: los avisos que ya están quedan como están. Solo cambia la función del trigger (mismo trigger y permisos).
-- Prueba: scripts/db/pruebas/aviso_pr_aprobado.sql
-- Vuelta atrás: supabase/rollback/20261102230000_aviso_pr_sin_repetidos.sql
begin;

CREATE OR REPLACE FUNCTION public.presupuesto_estado_alert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_title text;
BEGIN
  IF OLD.estado IS DISTINCT FROM NEW.estado AND NEW.estado IN ('aprobado', 'rechazado') THEN
    -- Quien hizo el cambio no recibe su propio aviso.
    IF NEW.created_by IS NOT NULL AND NEW.created_by = auth.uid() THEN
      RETURN NEW;
    END IF;
    v_title := CASE WHEN NEW.estado = 'aprobado' THEN 'PR aprobado: ' ELSE 'PR rechazado: ' END || NEW.numero;
    -- Ya tiene ese aviso sin leer: no se repite.
    IF EXISTS (
      SELECT 1 FROM public.alertas a
      WHERE a.entity_id = NEW.id AND a.title = v_title AND a.read = false
        AND a.user_id IS NOT DISTINCT FROM NEW.created_by
    ) THEN
      RETURN NEW;
    END IF;
    -- Alert on approval
    IF NEW.estado = 'aprobado' THEN
      INSERT INTO public.alertas (tipo, title, description, entity_id, entity_type, module, user_id, sociedad_id)
      VALUES (
        'seguimiento',
        v_title,
        'El presupuesto ' || NEW.numero || ' fue aprobado por '
          || CASE WHEN NEW.moneda::text = 'USD' THEN 'US$ ' ELSE '$ ' END
          || translate(to_char(coalesce(NEW.total, 0), 'FM999,999,999,990.00'), ',.', '.,'),
        NEW.id, 'presupuestos', 'presupuestos', NEW.created_by, NEW.sociedad_id
      );
    -- Alert on rejection
    ELSE
      INSERT INTO public.alertas (tipo, title, description, entity_id, entity_type, module, user_id, sociedad_id)
      VALUES (
        'seguimiento',
        v_title,
        'Motivo: ' || COALESCE(NEW.motivo_rechazo, 'Sin motivo especificado'),
        NEW.id, 'presupuestos', 'presupuestos', NEW.created_by, NEW.sociedad_id
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

commit;
