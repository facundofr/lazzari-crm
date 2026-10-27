-- Certificados de retenciones sufridas (Augusto 27/10/2026): «Cargar certificado (IA)» en Finanzas › Retenciones › Sufridas.
-- La IA lee el PDF y propone a qué retención va; una persona confirma. También se puede cargar el N° a mano.
-- Va en una tabla aparte porque a los movimientos de un cobro en US$ no se les puede cambiar el texto (trigger
-- proteger_movimiento_fx). El N° de esta tabla vale antes que el escrito en el texto del movimiento.
-- Solo AGREGA una tabla nueva: no cambia ni borra nada de lo que ya existe. «Quitar» no borra: marca anulado.
-- Vuelta atrás: supabase/rollback/20261027170000_certificados_retencion.sql
begin;

create table if not exists public.certificados_retencion (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users(id),
  sociedad_id uuid not null references public.sociedades(id),
  movimiento_id uuid not null references public.movimientos(id),   -- la retención sufrida (movimiento retencion_* de un cliente)
  numero text not null check (btrim(numero) <> ''),
  fecha date,                                                       -- fecha del certificado
  monto numeric(14,2),                                              -- importe retenido según el certificado
  agente_cuit text,                                                 -- CUIT de quien retuvo (el cliente), según el certificado
  archivo_url text,                                                 -- PDF o foto (bucket certificados, carpeta sufridas/)
  archivo_nombre text,
  origen text not null default 'manual' check (origen in ('ia', 'manual')),
  lectura_ia jsonb,                                                 -- lo que leyó la IA, para revisar
  anulado boolean not null default false,                           -- «Quitar»: no se borra
  anulado_at timestamptz,
  anulado_por uuid references auth.users(id)
);

-- Una retención tiene un solo certificado vigente.
create unique index if not exists certificados_retencion_mov_vigente_idx on public.certificados_retencion (movimiento_id) where not anulado;
create index if not exists certificados_retencion_sociedad_idx on public.certificados_retencion (sociedad_id) where not anulado;

comment on table public.certificados_retencion is 'N° y PDF del certificado de cada retención sufrida (cargado con IA o a mano); vale antes que el N° escrito en el texto del movimiento.';

-- El certificado va a una retención sufrida (de un cliente) de la misma sociedad.
create or replace function public.certificados_retencion_validar() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from public.movimientos m
                  where m.id = new.movimiento_id and m.sociedad_id = new.sociedad_id
                    and m.tipo::text like 'retencion\_%' and m.cliente_id is not null) then
    raise exception 'El certificado tiene que ir a una retención sufrida de la misma sociedad';
  end if;
  return new;
end $$;

drop trigger if exists certificados_retencion_validar on public.certificados_retencion;
create trigger certificados_retencion_validar before insert or update of movimiento_id, sociedad_id on public.certificados_retencion
  for each row execute function public.certificados_retencion_validar();

-- Mismos permisos que movimientos: super_admin, admin y administrativo. Sin borrar.
alter table public.certificados_retencion enable row level security;
drop policy if exists certificados_retencion_select on public.certificados_retencion;
create policy certificados_retencion_select on public.certificados_retencion for select
  using (get_my_role() = any (array['super_admin', 'admin', 'administrativo']::user_role[]));
drop policy if exists certificados_retencion_insert on public.certificados_retencion;
create policy certificados_retencion_insert on public.certificados_retencion for insert
  with check (get_my_role() = any (array['super_admin', 'admin', 'administrativo']::user_role[]));
drop policy if exists certificados_retencion_update on public.certificados_retencion;
create policy certificados_retencion_update on public.certificados_retencion for update
  using (get_my_role() = any (array['super_admin', 'admin', 'administrativo']::user_role[]));

commit;
