-- Finanzas › Cobrar y Pagar: «Sacar de pendientes» los SALDOS chicos (Augusto 02/11/2026: "cuando haya diferencias de menos de
-- 20.000 dejame tildar si quiero que sigan apareciendo o no ... no quiero que se esconda una factura chica, sino que sean SALDOS
-- menores a 20.000 ... y obviamente que queden en las cuentas corrientes").
-- Solo para facturas ya pagadas en parte con un saldo menor a $ 20.000 (los dólares al dólar divisa del día). La regla completa
-- la arma la pantalla (lib/saldos-pendientes); acá se controla que la factura exista, no esté anulada y que el saldo sea chico.
-- Una factura sacada deja de aparecer en Cobrar, Pagar, Vencimientos, Cobranzas y el Inicio; el saldo NO cambia y sigue en
-- Cuentas corrientes. «Volver a pendientes» no borra: marca anulado.
-- Solo AGREGA una tabla y 2 funciones: no cambia ni borra nada de lo que ya existe.
-- Vuelta atrás: supabase/rollback/20261102180000_saldos_fuera_de_pendientes.sql
begin;

create table if not exists public.saldos_fuera_de_pendientes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users(id),
  sociedad_id uuid not null references public.sociedades(id),
  factura_id uuid references public.facturas(id) on delete cascade,
  factura_compra_id uuid references public.facturas_compra(id) on delete cascade,
  saldo numeric(14,2) not null check (saldo > 0),
  moneda text not null default 'ARS' check (moneda in ('ARS', 'USD')),
  anulado boolean not null default false,
  anulado_at timestamptz,
  anulado_por uuid references auth.users(id),
  check ((factura_id is null) <> (factura_compra_id is null))
);
create unique index if not exists saldos_fuera_factura_activo
  on public.saldos_fuera_de_pendientes (factura_id) where not anulado and factura_id is not null;
create unique index if not exists saldos_fuera_factura_compra_activo
  on public.saldos_fuera_de_pendientes (factura_compra_id) where not anulado and factura_compra_id is not null;

alter table public.saldos_fuera_de_pendientes enable row level security;
drop policy if exists sfp_select on public.saldos_fuera_de_pendientes;
create policy sfp_select on public.saldos_fuera_de_pendientes for select
  using (get_my_role() = any (array['super_admin'::user_role, 'admin'::user_role, 'administrativo'::user_role, 'vendedor'::user_role, 'viewer'::user_role]));

create or replace function public.sacar_saldo_de_pendientes(p_factura_id uuid, p_factura_compra_id uuid, p_saldo numeric, p_moneda text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_soc uuid;
  v_estado text;
  v_dolar numeric;
  v_pesos numeric;
begin
  if coalesce(get_my_role()::text, '') not in ('super_admin', 'admin', 'administrativo') then
    raise exception 'No tenés permiso para sacar saldos de pendientes';
  end if;
  if (p_factura_id is null) = (p_factura_compra_id is null) then raise exception 'Indicá una sola factura'; end if;
  if coalesce(p_saldo, 0) <= 0 then raise exception 'La factura no tiene saldo'; end if;
  if coalesce(p_moneda, 'ARS') = 'USD' then
    select valor_venta into v_dolar from cotizaciones_dolar where tipo = 'oficial_divisas' and valor_venta > 0 order by fecha desc limit 1;
    if v_dolar is null then raise exception 'Falta el dólar del día para pasar el saldo a pesos'; end if;
    v_pesos := p_saldo * v_dolar;
  else
    v_pesos := p_saldo;
  end if;
  if v_pesos >= 20000 then raise exception 'Solo se sacan de pendientes los saldos menores a $ 20.000'; end if;
  if p_factura_id is not null then
    select sociedad_id, estado::text into v_soc, v_estado from facturas where id = p_factura_id;
  else
    select sociedad_id, estado::text into v_soc, v_estado from facturas_compra where id = p_factura_compra_id;
  end if;
  if v_soc is null then raise exception 'No se encontró la factura'; end if;
  if v_estado = 'anulada' then raise exception 'La factura está anulada'; end if;
  if exists (select 1 from saldos_fuera_de_pendientes where not anulado
             and (factura_id = p_factura_id or factura_compra_id = p_factura_compra_id)) then
    return jsonb_build_object('sacados', 0);
  end if;
  insert into saldos_fuera_de_pendientes (sociedad_id, factura_id, factura_compra_id, saldo, moneda, created_by)
  values (v_soc, p_factura_id, p_factura_compra_id, round(p_saldo, 2), coalesce(p_moneda, 'ARS'), auth.uid());
  return jsonb_build_object('sacados', 1);
end $$;

create or replace function public.volver_saldo_a_pendientes(p_factura_id uuid, p_factura_compra_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer := 0;
begin
  if coalesce(get_my_role()::text, '') not in ('super_admin', 'admin', 'administrativo') then
    raise exception 'No tenés permiso para volver saldos a pendientes';
  end if;
  update saldos_fuera_de_pendientes set anulado = true, anulado_at = now(), anulado_por = auth.uid()
  where not anulado and (factura_id = p_factura_id or factura_compra_id = p_factura_compra_id);
  get diagnostics v_n = row_count;
  return jsonb_build_object('vueltos', v_n);
end $$;

revoke all on function public.sacar_saldo_de_pendientes(uuid, uuid, numeric, text) from public, anon;
revoke all on function public.volver_saldo_a_pendientes(uuid, uuid) from public, anon;
grant execute on function public.sacar_saldo_de_pendientes(uuid, uuid, numeric, text) to authenticated;
grant execute on function public.volver_saldo_a_pendientes(uuid, uuid) to authenticated;
grant select on public.saldos_fuera_de_pendientes to authenticated;

commit;
