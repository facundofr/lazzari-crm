-- 16/10/2026 — ADITIVA (no toca datos existentes). Para deshacer: supabase/rollback/20261016180000_extracto_contraparte.sql
--
-- A quién fue / de quién vino cada línea del banco, leído del resumen PDF del BBVA (secciones Enviadas, Recibidas y
-- Débitos automáticos) o de ARCA "Mis comprobantes recibidos" (factura que paga una transferencia a un proveedor).
-- El extracto en Excel no trae ese dato. La bandeja "Para confirmar" lo usa para reconocer proveedor, cliente y reglas.
--   contraparte = {fuente, seccion, nombre, cuit, detalle, factura:{tipo, punto_venta, numero, fecha, total, emisor, cuit, unica}}

begin;

alter table public.extracto_movimientos add column if not exists contraparte jsonb;
comment on column public.extracto_movimientos.contraparte is 'Otra parte de la línea (resumen PDF BBVA / ARCA recibidos): {fuente, seccion, nombre, cuit, detalle, factura}. 16/10/2026.';

-- Guarda (o completa) la contraparte de varias líneas. Solo líneas de la sociedad; mezcla con lo que ya tenía.
create or replace function public.guardar_contrapartes_extracto(p_sociedad_id uuid, p_items jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_i jsonb;
  v_n integer := 0;
begin
  if not public.lz_puede_operar_finanzas(p_sociedad_id) then raise exception 'No tenés permisos para conciliar en esta sociedad'; end if;
  if jsonb_typeof(p_items) <> 'array' then raise exception 'Datos inválidos'; end if;
  for v_i in select value from jsonb_array_elements(p_items) loop
    update public.extracto_movimientos em
      set contraparte = coalesce(em.contraparte, '{}'::jsonb) || (v_i->'contraparte')
      from public.extractos_bancarios eb
      where em.id = (v_i->>'linea_id')::uuid and eb.id = em.extracto_id and eb.sociedad_id = p_sociedad_id
        and jsonb_typeof(v_i->'contraparte') = 'object';
    if found then v_n := v_n + 1; end if;
  end loop;
  return jsonb_build_object('guardadas', v_n);
end;
$$;
revoke all on function public.guardar_contrapartes_extracto(uuid, jsonb) from public, anon;
grant execute on function public.guardar_contrapartes_extracto(uuid, jsonb) to authenticated;

commit;
