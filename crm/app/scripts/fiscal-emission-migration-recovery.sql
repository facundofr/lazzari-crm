-- Durable emission reservation. Additive: does not edit any issued invoice.
-- Caller reserves after validations and BEFORE WSFE. Never release on timeout.
-- Save authorized ARCA result before local persistence, then completed HTTP result.
-- This ledger is NOT evidence of a valid CAE: only ARCA verification establishes it.
begin;

create table if not exists public.fiscal_emission_attempts (
  sociedad_id uuid not null references public.sociedades(id),
  request_key uuid not null,
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  request_payload jsonb not null check (jsonb_typeof(request_payload)='object' and octet_length(request_payload::text)<=1000000),
  punto_venta integer not null check (punto_venta between 1 and 99999),
  user_id uuid not null references public.profiles(id),
  state text not null default 'reserved' check (state in ('reserved','authorized','completed')),
  http_status integer check (http_status between 200 and 599),
  response jsonb check (response is null or jsonb_typeof(response) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (sociedad_id, request_key),
  check ((state = 'reserved' and http_status is null and response is null)
    or (state in ('authorized','completed') and http_status is not null and response is not null))
);

-- A different key cannot race the same PV, nor bypass an uncertain prior attempt.
create unique index if not exists fiscal_emission_attempts_unresolved_pv
  on public.fiscal_emission_attempts(sociedad_id,punto_venta)
  where state in ('reserved','authorized');

alter table public.fiscal_emission_attempts enable row level security;
revoke all on table public.fiscal_emission_attempts from public, anon, authenticated;
comment on table public.fiscal_emission_attempts is
  'Private issuance ledger. No direct client access. Uncertain reservations never expire. Reconcile against ARCA before any administrative recovery; never treat ledger JSON as CAE proof.';

create or replace function public.reservar_emision_fiscal(
  p_sociedad_id uuid, p_request_key uuid, p_payload_hash text, p_punto_venta integer, p_payload jsonb
) returns jsonb
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_user uuid := auth.uid();
  v_row public.fiscal_emission_attempts%rowtype;
  v_acquired boolean := false;
begin
  if v_user is null or not exists (
    select 1 from public.profiles where id = v_user and role in ('super_admin','admin','administrativo')
  ) or not exists (
    select 1 from public.user_sociedades where user_id = v_user and sociedad_id = p_sociedad_id
  ) then raise exception 'No tenés autorización para emitir en esta sociedad' using errcode = '42501'; end if;
  if p_sociedad_id is null or p_request_key is null or p_payload_hash is null
    or p_payload_hash !~ '^[a-f0-9]{64}$' or p_punto_venta is null or p_punto_venta not between 1 and 99999
    or p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>1000000
  then raise exception 'Reserva fiscal inválida' using errcode = '22023'; end if;

  begin
    insert into public.fiscal_emission_attempts(sociedad_id,request_key,payload_hash,punto_venta,user_id,request_payload)
      values(p_sociedad_id,p_request_key,p_payload_hash,p_punto_venta,v_user,p_payload)
      on conflict (sociedad_id,request_key) do nothing
      returning * into v_row;
    v_acquired := found;
  exception when unique_violation then
    -- The other unique key is the unresolved PV lock. Do not unlock or retry.
    raise exception 'Este punto de venta tiene una emisión pendiente de conciliación con ARCA. No se emitió otro comprobante.' using errcode = '55000';
  end;
  if not v_acquired then
    select * into v_row from public.fiscal_emission_attempts
      where sociedad_id=p_sociedad_id and request_key=p_request_key for update;
    if not found then raise exception 'No se pudo verificar la reserva fiscal' using errcode='55000'; end if;
    if v_row.user_id <> v_user then raise exception 'La reserva fiscal pertenece a otro usuario' using errcode='42501'; end if;
    if v_row.payload_hash <> p_payload_hash or v_row.punto_venta <> p_punto_venta or v_row.request_payload <> p_payload then
      raise exception 'La clave de emisión ya fue utilizada con otros datos' using errcode='22023';
    end if;
  end if;
  return jsonb_build_object('acquired',v_acquired,'state',v_row.state,'status',v_row.http_status,'response',v_row.response);
end;
$$;

create or replace function public.finalizar_emision_fiscal(
  p_sociedad_id uuid, p_request_key uuid, p_payload_hash text,
  p_state text, p_status integer, p_response jsonb
) returns jsonb
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_user uuid := auth.uid();
  v_row public.fiscal_emission_attempts%rowtype;
begin
  if v_user is null or not exists (
    select 1 from public.profiles where id=v_user and role in ('super_admin','admin','administrativo')
  ) or not exists (
    select 1 from public.user_sociedades where user_id=v_user and sociedad_id=p_sociedad_id
  ) then raise exception 'No tenés autorización para finalizar esta emisión' using errcode='42501'; end if;
  if p_state is null or p_state not in ('authorized','completed') or p_status is null or p_status not between 200 and 599
    or (p_state='authorized' and p_status <> 200) or p_response is null or jsonb_typeof(p_response)<>'object'
    or octet_length(p_response::text)>1000000 then
    raise exception 'Resultado fiscal inválido' using errcode='22023';
  end if;
  select * into v_row from public.fiscal_emission_attempts
    where sociedad_id=p_sociedad_id and request_key=p_request_key for update;
  if not found then raise exception 'La emisión no tiene reserva previa' using errcode='55000'; end if;
  if v_row.user_id <> v_user then raise exception 'La reserva fiscal pertenece a otro usuario' using errcode='42501'; end if;
  if p_payload_hash is null or v_row.payload_hash <> p_payload_hash then
    raise exception 'Los datos no coinciden con la reserva fiscal' using errcode='22023';
  end if;
  if v_row.state = p_state and v_row.http_status = p_status and v_row.response = p_response then
    return jsonb_build_object('acquired',false,'state',v_row.state,'status',v_row.http_status,'response',v_row.response);
  end if;
  if not (v_row.state='reserved' or (v_row.state='authorized' and p_state='completed')) then
    raise exception 'El resultado fiscal ya está fijado; no se puede reiniciar ni reemplazar' using errcode='55000';
  end if;
  update public.fiscal_emission_attempts set state=p_state,http_status=p_status,response=p_response,updated_at=now()
    where sociedad_id=p_sociedad_id and request_key=p_request_key returning * into v_row;
  return jsonb_build_object('acquired',false,'state',v_row.state,'status',v_row.http_status,'response',v_row.response);
end;
$$;

revoke all on function public.reservar_emision_fiscal(uuid,uuid,text,integer,jsonb) from public,anon;
revoke all on function public.finalizar_emision_fiscal(uuid,uuid,text,text,integer,jsonb) from public,anon;
grant execute on function public.reservar_emision_fiscal(uuid,uuid,text,integer,jsonb) to authenticated;
grant execute on function public.finalizar_emision_fiscal(uuid,uuid,text,text,integer,jsonb) to authenticated;
commit;
