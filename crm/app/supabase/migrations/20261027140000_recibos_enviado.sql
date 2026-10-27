-- «Enviado» en Recibos (auditoría UX 26/10/2026, arreglo 25; Augusto 27/10: "Avanzá con 1, 2, 4, 5, 6, 7 y 8").
-- Las OP guardan cuándo se mandaron por mail (ordenes_pago.email_enviado_at); los recibos no lo guardaban.
-- SOLO AGREGA: dos columnas vacías en recibos y una función para marcar el envío. No cambia ni borra datos.
-- Los recibos mandados antes quedan sin la marca: no hay registro de esos envíos.
-- La marca la pone la ventana de mail del recibo (recibo-doc.tsx) después de mandarlo.
-- Vuelta atrás: supabase/rollback/20261027140000_recibos_enviado.sql
-- Prueba (no guarda nada): node scripts/db/migrar.cjs supabase/migrations/20261027140000_recibos_enviado.sql --probar scripts/db/pruebas/recibos_enviado.sql

alter table public.recibos add column if not exists email_enviado_at timestamptz;
alter table public.recibos add column if not exists email_enviado_a text;

-- La tabla recibos solo se lee (grant select): el envío se marca con esta función, con los mismos permisos que ver recibos.
create or replace function public.marcar_recibo_enviado(
  p_recibo_id uuid,
  p_sociedad_id uuid,
  p_enviado_a text default null
) returns timestamptz
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_fecha timestamptz := now();
begin
  if auth.uid() is null
    or not exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('super_admin', 'admin', 'administrativo')
    )
    or not exists (
      select 1 from public.user_sociedades us
      where us.user_id = auth.uid() and us.sociedad_id = p_sociedad_id
    ) then
    raise exception 'No tenes permiso para marcar recibos en esta sociedad';
  end if;

  update public.recibos
  set email_enviado_at = v_fecha,
      email_enviado_a = nullif(left(trim(coalesce(p_enviado_a, '')), 500), '')
  where id = p_recibo_id and sociedad_id = p_sociedad_id;
  if not found then
    raise exception 'El recibo no es de esta sociedad';
  end if;

  return v_fecha;
end;
$function$;

revoke all on function public.marcar_recibo_enviado(uuid, uuid, text) from public, anon;
grant execute on function public.marcar_recibo_enviado(uuid, uuid, text) to authenticated;
