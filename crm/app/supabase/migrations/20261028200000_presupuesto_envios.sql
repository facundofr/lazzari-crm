-- Envíos por mail de los PR (Augusto 28/10/2026: "que en el PR quede la información de quién y cuándo lo mandaron,
-- como en las facturas de venta"; "si se manda más de una vez, que se registre más de una vez").
-- Cada vez que un PR sale por mail desde el CRM, el servidor (api/email/send) anota una fila: cuándo, a qué mails,
-- quién lo mandó (el usuario que entró, no lo que diga el navegador) y el id del envío.
-- Solo AGREGA una tabla nueva: no cambia ni borra nada de lo que ya existe. Las filas no se editan ni se borran.
-- Prueba: scripts/db/pruebas/presupuesto_envios.sql
-- Vuelta atrás: supabase/rollback/20261028200000_presupuesto_envios.sql
begin;

create table if not exists public.presupuesto_envios (
  id uuid primary key default gen_random_uuid(),
  presupuesto_id uuid not null references public.presupuestos(id) on delete cascade,
  sociedad_id uuid references public.sociedades(id),
  enviado_at timestamptz not null default now(),
  enviado_por uuid default auth.uid() references auth.users(id),
  enviado_a text not null check (btrim(enviado_a) <> ''),   -- mails separados por coma
  remitente text,                                           -- como salió: "Nombre <mail>"
  resend_id text                                            -- id del envío en Resend
);

create index if not exists presupuesto_envios_pr_idx on public.presupuesto_envios (presupuesto_id, enviado_at desc);

comment on table public.presupuesto_envios is 'Cada envío por mail de un PR desde el CRM: cuándo, a quién y quién lo mandó. Lo escribe api/email/send.';

-- Todos los usuarios ven las dos sociedades (decisión de Augusto) y cualquiera manda PR: leer y anotar con sesión.
-- Solo se anota a nombre propio. Sin editar ni borrar.
alter table public.presupuesto_envios enable row level security;
drop policy if exists presupuesto_envios_select on public.presupuesto_envios;
create policy presupuesto_envios_select on public.presupuesto_envios for select to authenticated using (true);
drop policy if exists presupuesto_envios_insert on public.presupuesto_envios;
create policy presupuesto_envios_insert on public.presupuesto_envios for insert to authenticated
  with check (enviado_por = auth.uid());
revoke all on public.presupuesto_envios from anon, authenticated;
grant select, insert on public.presupuesto_envios to authenticated;

commit;
