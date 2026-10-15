-- 15/10/2026 — ADITIVA (no toca datos existentes).
-- Para deshacer: supabase/rollback/20261015100000_agente_mail.sql
--
-- Agente de correo y cobros (casilla administracion@lazzari.com.ar). Solo SUGIERE: nunca registra cobros ni responde mails.
--  1. agente_mail_procesados: una fila por mail leído (clasificación, resumen, acción sugerida, datos de pago). Evita releer.
--  2. agente_mail_corridas: una fila por corrida (cuántos mails, costo en US$, errores) para el resumen y el tope diario.
-- Los inserts los hace el servidor (ruta programada con la service_role); la pantalla solo lee y marca "visto".

begin;

create table if not exists public.agente_mail_procesados (
  id uuid primary key default gen_random_uuid(),
  sociedad_id uuid not null references public.sociedades(id),
  gmail_message_id text not null,
  gmail_thread_id text,
  fecha_mail timestamptz,
  remitente text,
  asunto text,
  categoria text not null default 'otro'
    check (categoria in ('pago_retencion', 'reclamo_consulta', 'factura_proveedor', 'oc_cliente', 'vencimiento_aviso', 'otro')),
  prioridad text not null default 'normal' check (prioridad in ('alta', 'normal', 'baja')),
  resumen text,
  accion_sugerida text,
  datos jsonb,                      -- monto, cliente, CUIT, facturas, retenciones, cruce probable con facturas/extracto
  adjuntos jsonb,                   -- [{nombre, metodo: texto|vision|revisar_a_mano}]
  visto_at timestamptz,             -- lo marca Augusto en la pantalla (modo "solo mirar")
  visto_by uuid references public.profiles(id),
  costo_usd numeric(10,5) not null default 0,
  error text,
  created_at timestamptz not null default now(),
  unique (gmail_message_id)
);
create index if not exists agente_mail_proc_sociedad_idx on public.agente_mail_procesados (sociedad_id, visto_at, fecha_mail desc);
create index if not exists agente_mail_proc_creado_idx on public.agente_mail_procesados (created_at);

create table if not exists public.agente_mail_corridas (
  id uuid primary key default gen_random_uuid(),
  inicio timestamptz not null default now(),
  fin timestamptz,
  origen text not null default 'cron',          -- cron | manual
  mails_nuevos integer not null default 0,
  pendientes_restantes integer not null default 0,
  costo_usd numeric(10,5) not null default 0,
  topeado boolean not null default false,        -- se cortó por el tope diario de gasto
  resumen text,
  error text
);
create index if not exists agente_mail_corridas_inicio_idx on public.agente_mail_corridas (inicio desc);

alter table public.agente_mail_procesados enable row level security;
drop policy if exists agente_mail_proc_select on public.agente_mail_procesados;
create policy agente_mail_proc_select on public.agente_mail_procesados for select to authenticated
  using (public.lz_es_de_sociedad(sociedad_id));
drop policy if exists agente_mail_proc_update on public.agente_mail_procesados;
create policy agente_mail_proc_update on public.agente_mail_procesados for update to authenticated
  using (public.lz_es_de_sociedad(sociedad_id)) with check (public.lz_es_de_sociedad(sociedad_id));
grant select, update on public.agente_mail_procesados to authenticated;

alter table public.agente_mail_corridas enable row level security;
drop policy if exists agente_mail_corridas_select on public.agente_mail_corridas;
create policy agente_mail_corridas_select on public.agente_mail_corridas for select to authenticated using (true);
grant select on public.agente_mail_corridas to authenticated;

commit;
