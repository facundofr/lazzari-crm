-- Permisos por rol — 13/10/2026, con OK de Augusto (punto 6 de la revisión de la base).
--
-- Cómo trabaja Lazzari:
--   * Augusto (super_admin) ve y hace todo.
--   * Mariana (administrativa) lleva la plata y las compras.
--   * Los vendedores también compran: pedidos, OC, mandarlas al proveedor, recibir mercadería y cargar facturas de proveedores.
--     Llevan muestras, transportes y personalización. NO pagan.
--   * Todos ven, crean y editan clientes y proveedores. Eliminar: con motivo que queda guardado.
--
-- Qué cambia:
--   A) Plata: guardar/cambiar órdenes de pago, aplicaciones de cobros, eCheqs, saldos de caja, movimientos, retenciones y plantillas
--      de mail queda para super_admin, admin y administrativo. Leer sigue igual (cualquier logueado).
--      Gastos manuales: crear también los vendedores (la carga de una factura "solo IVA" crea su gasto); cambiar/borrar solo administración.
--   B) Rol administrativo: puede lo mismo que hoy tiene Mariana como admin en gastos fijos, crear presupuestos, notificaciones,
--      configuración general y plantillas de mail. (Usuarios, sociedades, comisiones y objetivos: no.)
--   C) Eliminar cliente / proveedor con motivo (funciones eliminar_cliente / eliminar_proveedor). Si tiene historial
--      (presupuestos, facturas, cobros, OC, listas de precios, etc.) NO se borra: se desactiva, para no perder datos.
--      Todo queda guardado en registros_eliminados (copia completa, motivo, quién y cuándo).
--   D) registrar_factura_compra_con_oc_extra: también los vendedores (cargan facturas de proveedores).
--
-- No se toca: cai_config / next_cai_number (numeración de remitos con CAI: es de ARCA y la usan los vendedores),
--   transportes, fichas, muestras, personalización, numeración, avisos, historial de precios, dólar.
-- Las 7 funciones de plata (anular factura de compra, extracto, cheques, cobro con diferencia) YA pedían administración.
--
-- Aditiva: no borra datos. Vuelta atrás: supabase/rollback/20261013100000_permisos_por_rol.sql
begin;

-- ── A) Plata: escribir solo administración ─────────────────────────────────────────────
alter policy "ordenes_pago_all" on public.ordenes_pago
  using (public.lz_tiene_rol(array['super_admin','admin','administrativo']))
  with check (public.lz_tiene_rol(array['super_admin','admin','administrativo']));
create policy "ordenes_pago_select" on public.ordenes_pago for select to authenticated using (true);

alter policy "op_fc_modify" on public.op_facturas_compra
  using (public.lz_tiene_rol(array['super_admin','admin','administrativo']))
  with check (public.lz_tiene_rol(array['super_admin','admin','administrativo']));

alter policy "cobro_aplicaciones_all" on public.cobro_aplicaciones
  using (public.lz_tiene_rol(array['super_admin','admin','administrativo']))
  with check (public.lz_tiene_rol(array['super_admin','admin','administrativo']));
create policy "cobro_aplicaciones_select" on public.cobro_aplicaciones for select to authenticated using (true);

alter policy "insert echeqs" on public.echeqs
  with check (public.lz_tiene_rol(array['super_admin','admin','administrativo']));
alter policy "update echeqs" on public.echeqs
  using (public.lz_tiene_rol(array['super_admin','admin','administrativo']));
alter policy "delete echeqs" on public.echeqs
  using (public.lz_tiene_rol(array['super_admin','admin','administrativo']));

alter policy "saldos_caja_all" on public.saldos_caja
  using (public.lz_tiene_rol(array['super_admin','admin','administrativo']))
  with check (public.lz_tiene_rol(array['super_admin','admin','administrativo']));
create policy "saldos_caja_select" on public.saldos_caja for select to authenticated using (true);

alter policy "gastos_manuales_all" on public.gastos_manuales
  using (public.lz_tiene_rol(array['super_admin','admin','administrativo']))
  with check (public.lz_tiene_rol(array['super_admin','admin','administrativo']));
create policy "gastos_manuales_select" on public.gastos_manuales for select to authenticated using (true);
create policy "gastos_manuales_insert_compras" on public.gastos_manuales for insert to authenticated
  with check (public.lz_tiene_rol(array['super_admin','admin','administrativo','vendedor']));

alter policy "vendedor_insert_movimientos" on public.movimientos
  with check (public.lz_tiene_rol(array['super_admin','admin','administrativo']));

alter policy "retencion_config_write" on public.retencion_config
  using (public.lz_tiene_rol(array['super_admin','admin','administrativo']))
  with check (public.lz_tiene_rol(array['super_admin','admin','administrativo']));

alter policy "email_templates_all" on public.email_templates
  using (public.lz_tiene_rol(array['super_admin','admin','administrativo']))
  with check (public.lz_tiene_rol(array['super_admin','admin','administrativo']));

-- ── B) Rol administrativo ──────────────────────────────────────────────────────────────
alter policy "gastos_fijos_write" on public.gastos_fijos
  using (public.lz_tiene_rol(array['super_admin','admin','administrativo']));
alter policy "presupuestos_insert" on public.presupuestos
  with check (get_my_role() = any (array['super_admin'::user_role, 'admin'::user_role, 'vendedor'::user_role, 'administrativo'::user_role]));
alter policy "notif_select" on public.notificaciones
  using ((creado_por = auth.uid()) or (get_my_role() = any (array['super_admin'::user_role, 'admin'::user_role, 'administrativo'::user_role])));
alter policy "notif_update" on public.notificaciones
  using (get_my_role() = any (array['super_admin'::user_role, 'admin'::user_role, 'administrativo'::user_role]));
alter policy "config_modify" on public.configuracion
  using (is_admin_or_above() or get_my_role() = 'administrativo'::user_role);
alter policy "Templates editables por admins" on public.email_templates
  using (public.lz_tiene_rol(array['super_admin','admin','administrativo']));

-- ── C) Eliminar cliente / proveedor con motivo ─────────────────────────────────────────
create table if not exists public.registros_eliminados (
  id uuid primary key default gen_random_uuid(),
  tabla text not null,
  registro_id uuid not null,
  sociedad_id uuid,
  nombre text,
  accion text not null check (accion in ('eliminado','desactivado')),
  motivo text not null,
  historial jsonb,
  datos jsonb not null,
  usuario_id uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists registros_eliminados_registro_idx on public.registros_eliminados (tabla, registro_id);
alter table public.registros_eliminados enable row level security;
create policy "registros_eliminados_select" on public.registros_eliminados for select to authenticated
  using (public.lz_tiene_rol(array['super_admin','admin','administrativo']) or usuario_id = auth.uid());
comment on table public.registros_eliminados is
  'Clientes y proveedores eliminados o desactivados desde el CRM: copia completa, motivo, quién y cuándo. Se escribe solo con eliminar_cliente / eliminar_proveedor.';

-- Cuenta lo que hay en las tablas que apuntan a la tabla dada (opcional: sin las que se borran en cadena).
create or replace function public.lz_historial_registro(p_tabla regclass, p_id uuid, p_incluir_cascada boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  r record;
  v_n bigint;
  v_res jsonb := '{}'::jsonb;
begin
  for r in
    select c.conrelid::regclass as t, a.attname as col
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.confrelid = p_tabla and array_length(c.conkey, 1) = 1
      and (p_incluir_cascada or c.confdeltype <> 'c')
  loop
    execute format('select count(*) from %s where %I = $1', r.t, r.col) into v_n using p_id;
    if v_n > 0 then v_res := v_res || jsonb_build_object(r.t::text, v_n); end if;
  end loop;
  return v_res;
end;
$function$;
revoke all on function public.lz_historial_registro(regclass, uuid, boolean) from public, anon, authenticated;

create or replace function public.eliminar_cliente(p_cliente_id uuid, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_cli public.clientes%rowtype;
  v_hist jsonb;
  v_datos jsonb;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
begin
  if auth.uid() is null or not public.lz_tiene_rol(array['super_admin','admin','administrativo','vendedor']) then
    raise exception 'No tenés permiso para eliminar clientes' using errcode = '42501';
  end if;
  if v_motivo is null or length(v_motivo) < 3 then
    raise exception 'Escribí el motivo para eliminar el cliente';
  end if;
  select * into v_cli from public.clientes where id = p_cliente_id for update;
  if not found then raise exception 'El cliente ya no existe'; end if;
  if not public.lz_es_de_sociedad(v_cli.sociedad_id) then
    raise exception 'No tenés permiso en la sociedad de este cliente' using errcode = '42501';
  end if;

  v_hist := public.lz_historial_registro('public.clientes'::regclass, p_cliente_id, false);
  v_datos := jsonb_build_object(
    'cliente', to_jsonb(v_cli),
    'sucursales', coalesce((select jsonb_agg(to_jsonb(s)) from public.cliente_sucursales s where s.cliente_id = p_cliente_id), '[]'::jsonb),
    'contactos', coalesce((select jsonb_agg(to_jsonb(c)) from public.contactos c where c.entity_type::text = 'cliente' and c.entity_id = p_cliente_id), '[]'::jsonb)
  );

  if v_hist <> '{}'::jsonb then
    update public.clientes set activo = false where id = p_cliente_id;
    insert into public.registros_eliminados (tabla, registro_id, sociedad_id, nombre, accion, motivo, historial, datos)
    values ('clientes', p_cliente_id, v_cli.sociedad_id, v_cli.razon_social, 'desactivado', v_motivo, v_hist, v_datos);
    return jsonb_build_object('accion', 'desactivado', 'historial', v_hist);
  end if;

  insert into public.registros_eliminados (tabla, registro_id, sociedad_id, nombre, accion, motivo, historial, datos)
  values ('clientes', p_cliente_id, v_cli.sociedad_id, v_cli.razon_social, 'eliminado', v_motivo, v_hist, v_datos);
  delete from public.contactos where entity_type::text = 'cliente' and entity_id = p_cliente_id;
  delete from public.clientes where id = p_cliente_id;
  return jsonb_build_object('accion', 'eliminado', 'historial', v_hist);
end;
$function$;
revoke all on function public.eliminar_cliente(uuid, text) from public, anon;
grant execute on function public.eliminar_cliente(uuid, text) to authenticated;

create or replace function public.eliminar_proveedor(p_proveedor_id uuid, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_prov public.proveedores%rowtype;
  v_hist jsonb;
  v_datos jsonb;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
begin
  if auth.uid() is null or not public.lz_tiene_rol(array['super_admin','admin','administrativo','vendedor']) then
    raise exception 'No tenés permiso para eliminar proveedores' using errcode = '42501';
  end if;
  if v_motivo is null or length(v_motivo) < 3 then
    raise exception 'Escribí el motivo para eliminar el proveedor';
  end if;
  select * into v_prov from public.proveedores where id = p_proveedor_id for update;
  if not found then raise exception 'El proveedor ya no existe'; end if;
  if not public.lz_es_de_sociedad(v_prov.sociedad_id) then
    raise exception 'No tenés permiso en la sociedad de este proveedor' using errcode = '42501';
  end if;

  -- Proveedores: cuenta TODO (también listas de precios y catálogo, que se borrarían en cadena).
  v_hist := public.lz_historial_registro('public.proveedores'::regclass, p_proveedor_id, true);
  v_datos := jsonb_build_object(
    'proveedor', to_jsonb(v_prov),
    'contactos', coalesce((select jsonb_agg(to_jsonb(c)) from public.contactos c where c.entity_type::text = 'proveedor' and c.entity_id = p_proveedor_id), '[]'::jsonb)
  );

  if v_hist <> '{}'::jsonb then
    update public.proveedores set activo = false where id = p_proveedor_id;
    insert into public.registros_eliminados (tabla, registro_id, sociedad_id, nombre, accion, motivo, historial, datos)
    values ('proveedores', p_proveedor_id, v_prov.sociedad_id, v_prov.razon_social, 'desactivado', v_motivo, v_hist, v_datos);
    return jsonb_build_object('accion', 'desactivado', 'historial', v_hist);
  end if;

  insert into public.registros_eliminados (tabla, registro_id, sociedad_id, nombre, accion, motivo, historial, datos)
  values ('proveedores', p_proveedor_id, v_prov.sociedad_id, v_prov.razon_social, 'eliminado', v_motivo, v_hist, v_datos);
  delete from public.contactos where entity_type::text = 'proveedor' and entity_id = p_proveedor_id;
  delete from public.proveedores where id = p_proveedor_id;
  return jsonb_build_object('accion', 'eliminado', 'historial', v_hist);
end;
$function$;
revoke all on function public.eliminar_proveedor(uuid, text) from public, anon;
grant execute on function public.eliminar_proveedor(uuid, text) to authenticated;

-- ── C2) Consulta de facturas: reenviar una factura de venta deja la marca de envío ─────
-- Los vendedores no pueden cambiar facturas; esta función solo toca las 4 columnas del envío por mail.
create or replace function public.marcar_factura_enviada(p_factura_id uuid, p_to text, p_resend_id text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_soc uuid;
begin
  if auth.uid() is null or not public.lz_tiene_rol(array['super_admin','admin','administrativo','vendedor']) then
    raise exception 'No tenés permiso' using errcode = '42501';
  end if;
  select sociedad_id into v_soc from public.facturas where id = p_factura_id;
  if v_soc is null or not public.lz_es_de_sociedad(v_soc) then
    raise exception 'No tenés permiso en la sociedad de esta factura' using errcode = '42501';
  end if;
  update public.facturas
     set email_enviado_at = now(),
         email_enviado_a = nullif(btrim(coalesce(p_to, '')), ''),
         email_estado = 'sent',
         email_resend_id = coalesce(nullif(p_resend_id, ''), email_resend_id)
   where id = p_factura_id;
end;
$function$;
revoke all on function public.marcar_factura_enviada(uuid, text, text) from public, anon;
grant execute on function public.marcar_factura_enviada(uuid, text, text) to authenticated;

-- ── D) Factura de compra con renglones fuera de la OC: también vendedores ──────────────
-- (se agrega abajo la función completa, copiada de la base, con 'vendedor' en la lista de roles)
CREATE OR REPLACE FUNCTION public.registrar_factura_compra_con_oc_extra(p_sociedad_id uuid, p_factura jsonb, p_items jsonb, p_orden_compra_ids uuid[], p_items_extra jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_user uuid := auth.uid();
  v_proveedor_id uuid;
  v_factura_id uuid;
  v_oc_extra_id uuid;
  v_numero text;
  v_numero_normalizado text;
  v_partes text[];
  v_fecha date;
  v_fecha_vencimiento date;
  v_moneda public.moneda_type;
  v_estado text;
  v_tipo_comprobante text;
  v_subtotal numeric;
  v_iva_porcentaje numeric;
  v_iva numeric;
  v_percepciones numeric;
  v_total numeric;
  v_item jsonb;
  v_descripcion text;
  v_codigo text;
  v_unidad text;
  v_cantidad numeric;
  v_precio numeric;
  v_descuento numeric;
  v_item_iva numeric;
  v_extra_subtotal numeric := 0;
  v_extra_iva numeric := 0;
  v_orden integer := 0;
  v_count integer;
begin
  if v_user is null
    or not exists (
      select 1 from public.profiles
      where id = v_user and role::text in ('super_admin', 'admin', 'administrativo', 'vendedor')
    )
    or not exists (
      select 1 from public.user_sociedades
      where user_id = v_user and sociedad_id = p_sociedad_id
    )
  then
    raise exception 'No tenés autorización para registrar compras en esta sociedad' using errcode = '42501';
  end if;

  if p_sociedad_id is null
    or p_factura is null or jsonb_typeof(p_factura) <> 'object'
    or p_items is null or jsonb_typeof(p_items) <> 'array'
    or p_items_extra is null or jsonb_typeof(p_items_extra) <> 'array'
    or p_orden_compra_ids is null
    or jsonb_array_length(p_items) > 500
    or jsonb_array_length(p_items_extra) = 0
    or jsonb_array_length(p_items_extra) > 500
    or coalesce(cardinality(p_orden_compra_ids), 0) = 0
  then
    raise exception 'Datos incompletos para registrar la factura y su OC extra' using errcode = '22023';
  end if;

  begin
    v_proveedor_id := nullif(p_factura->>'proveedor_id', '')::uuid;
    v_numero := btrim(coalesce(p_factura->>'numero_factura', ''));
    v_fecha := (p_factura->>'fecha')::date;
    v_fecha_vencimiento := nullif(p_factura->>'fecha_vencimiento', '')::date;
    v_moneda := p_factura->>'moneda';
    v_estado := p_factura->>'estado';
    v_tipo_comprobante := btrim(coalesce(p_factura->>'tipo_comprobante', ''));
    v_subtotal := (p_factura->>'subtotal')::numeric;
    v_iva_porcentaje := (p_factura->>'iva_porcentaje')::numeric;
    v_iva := (p_factura->>'iva')::numeric;
    v_percepciones := (p_factura->>'percepciones')::numeric;
    v_total := (p_factura->>'total')::numeric;
  exception when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range then
    raise exception 'Los datos de la factura tienen un formato inválido' using errcode = '22023';
  end;

  if v_proveedor_id is null or v_numero = '' or v_tipo_comprobante = ''
    or v_moneda not in ('ARS', 'USD')
    or v_estado not in ('pagada', 'pendiente_aprobacion')
    or coalesce(p_factura->>'tipo', '') <> 'mercaderia'
    or v_subtotal < 0 or v_iva < 0 or v_percepciones < 0 or v_total <= 0
    or v_iva_porcentaje < 0 or v_iva_porcentaje > 100
  then
    raise exception 'Los datos de la factura son inválidos' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.proveedores
    where id = v_proveedor_id and sociedad_id = p_sociedad_id
  ) then
    raise exception 'El proveedor no pertenece a la sociedad seleccionada' using errcode = '22023';
  end if;

  select count(*) into v_count
  from (select distinct id from unnest(p_orden_compra_ids) as ids(id)) selected;
  if v_count <> cardinality(p_orden_compra_ids) then
    raise exception 'La selección de OC contiene duplicados' using errcode = '22023';
  end if;

  -- Bloquea las OC en orden estable y vuelve a validar los datos que impactan
  -- la conciliación. No se confía en el estado que leyó previamente el navegador.
  perform 1
  from public.ordenes_compra
  where id = any(p_orden_compra_ids)
  order by id
  for update;

  select count(*) into v_count
  from public.ordenes_compra
  where id = any(p_orden_compra_ids)
    and sociedad_id = p_sociedad_id
    and proveedor_id = v_proveedor_id
    and moneda::text = v_moneda::text
    and estado::text not in ('cancelada', 'borrador');
  if v_count <> cardinality(p_orden_compra_ids) then
    raise exception 'Las OC deben estar activas y pertenecer al proveedor, sociedad y moneda de la factura' using errcode = '22023';
  end if;

  -- Serializa altas equivalentes para evitar dos facturas del mismo proveedor
  -- y número cuando dos pestañas confirman simultáneamente.
  v_numero_normalizado := upper(regexp_replace(v_numero, '\s+', '', 'g'));
  v_partes := regexp_match(v_numero_normalizado, '^([0-9]{1,5})[-/]([0-9]{1,8})$');
  if v_partes is not null then
    v_numero_normalizado := lpad(v_partes[1], 5, '0') || '-' || lpad(v_partes[2], 8, '0');
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_sociedad_id::text || ':' || v_proveedor_id::text || ':' || v_numero_normalizado, 0));

  if exists (
    select 1
    from public.facturas_compra fc
    left join lateral regexp_match(
      upper(regexp_replace(btrim(fc.numero_factura), '\s+', '', 'g')),
      '^([0-9]{1,5})[-/]([0-9]{1,8})$'
    ) as parsed(parts) on true
    where fc.sociedad_id = p_sociedad_id
      and fc.proveedor_id = v_proveedor_id
      and (
        case
          when parsed.parts is not null then lpad(parsed.parts[1], 5, '0') || '-' || lpad(parsed.parts[2], 8, '0')
          else upper(regexp_replace(btrim(fc.numero_factura), '\s+', '', 'g'))
        end
      ) = v_numero_normalizado
  ) then
    raise exception 'La factura % de este proveedor ya está cargada', v_numero using errcode = '23505';
  end if;

  -- Se validan todos los renglones antes de escribir la primera fila.
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(v_item) <> 'object'
      or jsonb_typeof(v_item->'cantidad') <> 'number'
      or jsonb_typeof(v_item->'precio_unitario') <> 'number'
      or jsonb_typeof(v_item->'descuento_porcentaje') <> 'number'
      or jsonb_typeof(v_item->'iva_porcentaje') <> 'number'
    then
      raise exception 'Un ítem de factura tiene un formato inválido' using errcode = '22023';
    end if;
    v_descripcion := btrim(coalesce(v_item->>'descripcion', ''));
    v_cantidad := (v_item->>'cantidad')::numeric;
    v_precio := (v_item->>'precio_unitario')::numeric;
    v_descuento := (v_item->>'descuento_porcentaje')::numeric;
    v_item_iva := (v_item->>'iva_porcentaje')::numeric;
    if v_descripcion = '' or v_cantidad <= 0 or v_precio < 0
      or v_descuento < 0 or v_descuento > 100 or v_item_iva < 0 or v_item_iva > 100
    then
      raise exception 'Un ítem de factura tiene valores inválidos' using errcode = '22023';
    end if;
  end loop;

  for v_item in select value from jsonb_array_elements(p_items_extra)
  loop
    if jsonb_typeof(v_item) <> 'object'
      or jsonb_typeof(v_item->'cantidad') <> 'number'
      or jsonb_typeof(v_item->'precio_unitario') <> 'number'
      or jsonb_typeof(v_item->'iva_porcentaje') <> 'number'
    then
      raise exception 'Un ítem extra tiene un formato inválido' using errcode = '22023';
    end if;
    v_descripcion := btrim(coalesce(v_item->>'descripcion', ''));
    v_cantidad := (v_item->>'cantidad')::numeric;
    v_precio := (v_item->>'precio_unitario')::numeric;
    v_item_iva := (v_item->>'iva_porcentaje')::numeric;
    if v_descripcion = '' or v_cantidad <= 0 or v_precio < 0 or v_item_iva < 0 or v_item_iva > 100 then
      raise exception 'Un ítem extra tiene valores inválidos' using errcode = '22023';
    end if;
    v_extra_subtotal := v_extra_subtotal + v_cantidad * v_precio;
    v_extra_iva := v_extra_iva + v_cantidad * v_precio * v_item_iva / 100;
  end loop;

  v_extra_subtotal := round(v_extra_subtotal, 2);
  v_extra_iva := round(v_extra_iva, 2);

  insert into public.facturas_compra (
    numero_factura, tipo_comprobante, proveedor_id, fecha, fecha_vencimiento,
    subtotal, iva_porcentaje, iva, percepciones, total, moneda, estado, tipo,
    solo_iva, notas, cae, sociedad_id, created_by
  ) values (
    v_numero, v_tipo_comprobante, v_proveedor_id, v_fecha, v_fecha_vencimiento,
    v_subtotal, v_iva_porcentaje, v_iva, v_percepciones, v_total, v_moneda,
    v_estado, 'mercaderia', false, nullif(p_factura->>'notas', ''),
    nullif(p_factura->>'cae', ''), p_sociedad_id, v_user
  ) returning id into v_factura_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    insert into public.facturas_compra_items (
      factura_compra_id, producto_id, codigo, descripcion, cantidad,
      precio_unitario, descuento_porcentaje, unidad, iva_porcentaje, sociedad_id
    ) values (
      v_factura_id, null, nullif(v_item->>'codigo', ''), btrim(v_item->>'descripcion'),
      (v_item->>'cantidad')::numeric, (v_item->>'precio_unitario')::numeric,
      (v_item->>'descuento_porcentaje')::numeric, coalesce(nullif(v_item->>'unidad', ''), 'u'),
      (v_item->>'iva_porcentaje')::numeric, p_sociedad_id
    );
  end loop;

  insert into public.factura_compra_ocs (factura_compra_id, orden_compra_id)
  select v_factura_id, id from unnest(p_orden_compra_ids) as ids(id);

  insert into public.ordenes_compra (
    proveedor_id, fecha, moneda, estado, estado_pago, subtotal, iva, total,
    sociedad_id, presupuesto_origen_id, observaciones, created_by
  ) values (
    v_proveedor_id, v_fecha, v_moneda, 'enviada', 'pendiente',
    v_extra_subtotal, v_extra_iva, round(v_extra_subtotal + v_extra_iva, 2),
    p_sociedad_id, null, 'OC generada automáticamente por extras de FC ' || v_numero, v_user
  ) returning id into v_oc_extra_id;

  v_orden := 0;
  for v_item in select value from jsonb_array_elements(p_items_extra)
  loop
    v_codigo := coalesce(v_item->>'codigo', '');
    v_descripcion := btrim(v_item->>'descripcion');
    v_unidad := coalesce(nullif(v_item->>'unidad', ''), 'u');
    v_cantidad := (v_item->>'cantidad')::numeric;
    v_precio := (v_item->>'precio_unitario')::numeric;
    v_item_iva := (v_item->>'iva_porcentaje')::numeric;
    insert into public.orden_compra_items (
      orden_id, codigo, descripcion, cantidad, cantidad_recibida, unidad,
      precio_unitario, iva_porcentaje, orden
    ) values (
      v_oc_extra_id, v_codigo, v_descripcion, v_cantidad, v_cantidad, v_unidad,
      v_precio, v_item_iva, v_orden
    );
    v_orden := v_orden + 1;
  end loop;

  insert into public.factura_compra_ocs (factura_compra_id, orden_compra_id)
  values (v_factura_id, v_oc_extra_id);

  return jsonb_build_object(
    'factura_compra_id', v_factura_id,
    'orden_compra_extra_id', v_oc_extra_id,
    'subtotal_extra', v_extra_subtotal,
    'iva_extra', v_extra_iva,
    'total_extra', round(v_extra_subtotal + v_extra_iva, 2)
  );
end;
$function$;

commit;
