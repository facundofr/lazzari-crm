-- Laura (laura@lazzari.com.ar) → Mariana (mariana@lazzari.com.ar), 12/10/2026, pedido de Augusto.
-- 1) Lo que cargó Laura (1 movimiento + 15 registros de actividad) pasa a nombre de Mariana.
--    En la actividad queda la marca "pasado_de: laura@lazzari.com.ar" para saber de dónde vino.
-- 2) Se borra el usuario de Laura (ficha y acceso).
-- ⚠️ El borrado del usuario NO tiene vuelta atrás: si algún día vuelve, se la invita de nuevo desde el CRM.
-- Todo junto: si algo falla, no se cambia nada.
begin;

-- Antes: lo que se pasa a Mariana (guardar esta foto)
select 'movimiento' as que, m.id::text, m.fecha::text, m.tipo::text, m.descripcion, m.monto::text
from public.movimientos m
where m.created_by = (select id from auth.users where lower(email) = 'laura@lazzari.com.ar')
union all
select 'actividad', count(*)::text, null, null, null, null
from public.activity_log a
where a.user_id = (select id from auth.users where lower(email) = 'laura@lazzari.com.ar');

do $$
declare
  v_laura uuid;
  v_mariana uuid;
begin
  select id into v_laura from auth.users where lower(email) = 'laura@lazzari.com.ar';
  select id into v_mariana from auth.users where lower(email) = 'mariana@lazzari.com.ar';
  if v_laura is null then raise exception 'No encontré a Laura'; end if;
  if v_mariana is null then raise exception 'No encontré a Mariana'; end if;

  update public.movimientos set created_by = v_mariana where created_by = v_laura;

  update public.activity_log
  set user_id = v_mariana,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('pasado_de', 'laura@lazzari.com.ar')
  where user_id = v_laura;

  delete from public.user_sociedades where user_id = v_laura;
  delete from public.profiles where id = v_laura;
  delete from auth.users where id = v_laura;
end $$;

-- Después: Laura ya no existe (0) y Mariana tiene lo que era de ella
select
  (select count(*) from auth.users where lower(email) = 'laura@lazzari.com.ar') as laura_existe,
  (select count(*) from public.activity_log where metadata->>'pasado_de' = 'laura@lazzari.com.ar') as actividad_pasada_a_mariana;

commit;
