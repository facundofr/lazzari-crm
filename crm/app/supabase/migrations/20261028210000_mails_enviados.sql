-- Correos enviados (Augusto 28/10/2026: "una especie de bandeja de mails de cada usuario y que quede el registro de
-- todos los envíos verificados ahí"). Cada mail que sale del CRM por api/email/send (PR, remitos, OC, facturas, OP,
-- recibos, resumen de cuenta) queda en esta tabla: cuándo, quién, desde qué remitente, a quién, asunto, documento y su
-- estado en Resend (enviado → entregado / rebotado / demorado / spam), que el CRM va verificando.
-- Reemplaza a presupuesto_envios como fuente de los envíos del PR (sus filas se copian acá; esa tabla queda, no se borra).
-- Solo AGREGA: no cambia ni borra nada de lo que ya existe. Las filas no se borran; solo se actualiza su estado.
-- Prueba: scripts/db/pruebas/mails_enviados.sql
-- Vuelta atrás: supabase/rollback/20261028210000_mails_enviados.sql
begin;

create table if not exists public.mails_enviados (
  id uuid primary key default gen_random_uuid(),
  enviado_at timestamptz not null default now(),
  enviado_por uuid default auth.uid() references auth.users(id),
  sociedad_id uuid references public.sociedades(id),
  remitente text,                                     -- como salió: "Nombre <mail>"
  enviado_a text not null check (btrim(enviado_a) <> ''),   -- mails separados por coma
  asunto text,
  documento_tipo text,                                -- presupuesto, remito, orden_compra, factura, orden_pago, recibo, resumen_cuenta…
  documento_id uuid,                                  -- id del documento si la pantalla lo manda (PR)
  documento_nombre text,                              -- nombre del PDF adjunto (ej. PR-2026-1285.pdf)
  resend_id text,
  estado text not null default 'enviado' check (estado in ('enviado', 'entregado', 'rebotado', 'demorado', 'spam')),
  estado_at timestamptz,                              -- cuándo pasó al estado actual (según Resend)
  verificado_at timestamptz,                          -- última vez que el CRM le preguntó a Resend
  aviso_rebote boolean not null default false         -- ya se avisó en la campana que rebotó
);

create index if not exists mails_enviados_por_idx on public.mails_enviados (enviado_por, enviado_at desc);
create index if not exists mails_enviados_doc_idx on public.mails_enviados (documento_tipo, documento_id);
create index if not exists mails_enviados_pendientes_idx on public.mails_enviados (enviado_at) where estado in ('enviado', 'demorado');

comment on table public.mails_enviados is 'Cada mail que sale del CRM (api/email/send) con su estado verificado en Resend. Bandeja "Correos enviados".';

-- Los envíos de PR que ya estaban anotados pasan a esta tabla (una sola fuente).
insert into public.mails_enviados (enviado_at, enviado_por, sociedad_id, remitente, enviado_a, documento_tipo, documento_id, documento_nombre, resend_id)
select e.enviado_at, e.enviado_por, e.sociedad_id, e.remitente, e.enviado_a, 'presupuesto', e.presupuesto_id, p.numero || '.pdf', e.resend_id
from public.presupuesto_envios e
left join public.presupuestos p on p.id = e.presupuesto_id
where not exists (select 1 from public.mails_enviados m where m.resend_id is not distinct from e.resend_id and m.documento_id = e.presupuesto_id);

-- Todos los usuarios ven las dos sociedades (decisión de Augusto): con sesión se lee todo; la pantalla muestra a cada uno
-- lo suyo y a admin / super admin todos. Se anota solo a nombre propio. Del resto, solo se puede actualizar el estado.
alter table public.mails_enviados enable row level security;
drop policy if exists mails_enviados_select on public.mails_enviados;
create policy mails_enviados_select on public.mails_enviados for select to authenticated using (true);
drop policy if exists mails_enviados_insert on public.mails_enviados;
create policy mails_enviados_insert on public.mails_enviados for insert to authenticated with check (enviado_por = auth.uid());
drop policy if exists mails_enviados_update on public.mails_enviados;
create policy mails_enviados_update on public.mails_enviados for update to authenticated using (true) with check (true);
revoke all on public.mails_enviados from anon, authenticated;
grant select, insert on public.mails_enviados to authenticated;
grant update (estado, estado_at, verificado_at, aviso_rebote) on public.mails_enviados to authenticated;

commit;
