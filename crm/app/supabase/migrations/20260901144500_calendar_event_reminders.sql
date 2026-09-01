-- Recordatorios automáticos del calendario. Supabase los genera aunque ningún
-- usuario tenga el CRM abierto; la campana del encabezado los muestra luego.

alter table public.eventos
  add column if not exists recordatorio_enviado_at timestamptz;

-- No generar una avalancha de alertas por eventos anteriores a esta función.
update public.eventos
set recordatorio_enviado_at = now()
where fecha_inicio <= now()
  and recordatorio_enviado_at is null;

create unique index if not exists alertas_evento_recordatorio_unique
on public.alertas (entity_id, user_id)
where entity_type = 'evento' and module = 'calendario';

create or replace function public.generar_recordatorios_eventos()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_insertadas integer := 0;
begin
  with eventos_pendientes as (
    select
      e.*,
      case
        when e.todo_el_dia then
          (((e.fecha_inicio at time zone 'America/Argentina/Buenos_Aires')::date + time '09:00')
            at time zone 'America/Argentina/Buenos_Aires')
        else e.fecha_inicio
      end as momento_recordatorio
    from public.eventos e
    where not e.completado
      and e.recordatorio_enviado_at is null
      and coalesce(e.user_id, e.created_by) is not null
  ), insertadas as (
    insert into public.alertas (
      tipo, title, description, entity_id, entity_type, module,
      user_id, sociedad_id, read
    )
    select
      'seguimiento',
      'Evento: ' || ep.titulo,
      case
        when ep.todo_el_dia then 'Recordatorio para hoy. ' || coalesce(ep.descripcion, '')
        else 'El evento comienza ahora. ' || coalesce(ep.descripcion, '')
      end,
      ep.id,
      'evento',
      'calendario',
      coalesce(ep.user_id, ep.created_by),
      ep.sociedad_id,
      false
    from eventos_pendientes ep
    where ep.momento_recordatorio <= now()
      and ep.momento_recordatorio >= now() - interval '24 hours'
    on conflict (entity_id, user_id)
      where entity_type = 'evento' and module = 'calendario'
      do nothing
    returning entity_id
  )
  select count(*) into v_insertadas from insertadas;

  update public.eventos e
  set recordatorio_enviado_at = now()
  where e.recordatorio_enviado_at is null
    and exists (
      select 1
      from public.alertas a
      where a.entity_type = 'evento'
        and a.module = 'calendario'
        and a.entity_id = e.id
        and a.user_id = coalesce(e.user_id, e.created_by)
    );

  return v_insertadas;
end;
$$;

-- Si cambia la fecha o el responsable, el recordatorio vuelve a programarse.
create or replace function public.reprogramar_recordatorio_evento()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.fecha_inicio is distinct from new.fecha_inicio
     or old.todo_el_dia is distinct from new.todo_el_dia
     or old.user_id is distinct from new.user_id then
    delete from public.alertas
    where entity_type = 'evento'
      and module = 'calendario'
      and entity_id = old.id;
    new.recordatorio_enviado_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists reprogramar_recordatorio_evento on public.eventos;
create trigger reprogramar_recordatorio_evento
before update of fecha_inicio, todo_el_dia, user_id
on public.eventos
for each row execute function public.reprogramar_recordatorio_evento();

create extension if not exists pg_cron;

do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id
  from cron.job
  where jobname = 'recordatorios-eventos';

  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;

  perform cron.schedule(
    'recordatorios-eventos',
    '* * * * *',
    'select public.generar_recordatorios_eventos();'
  );
end;
$$;

comment on column public.eventos.recordatorio_enviado_at is
  'Momento en que se creó la alerta automática correspondiente al evento.';
