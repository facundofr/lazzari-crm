-- Vuelta atrás de 20261028120000_seguridad_cerrar_anonimo.sql: deja los permisos EXACTAMENTE como estaban el 28/10/2026
-- (vuelve a abrir al anónimo la cotización, las vistas, las 14 funciones y los archivos). No toca datos.
begin;

-- 1. Cotización del dólar
grant insert, update, delete, truncate, references, trigger on public.cotizaciones_dolar to anon;
drop policy if exists cotiz_insert_anon on public.cotizaciones_dolar;
create policy cotiz_insert_anon on public.cotizaciones_dolar for insert to anon with check (true);
drop policy if exists cotiz_update_anon on public.cotizaciones_dolar;
create policy cotiz_update_anon on public.cotizaciones_dolar for update to anon using (true) with check (true);

-- 2. Vistas
alter view public.v_comparador_precios reset (security_invoker);
alter view public.v_cuenta_corriente_clientes reset (security_invoker);
alter view public.v_cuenta_corriente_proveedores reset (security_invoker);
alter view public.v_facturas_pendientes reset (security_invoker);
alter view public.v_ordenes_compra_progreso reset (security_invoker);
alter view public.v_presupuestos_completos reset (security_invoker);
alter view public.v_stock_alertas reset (security_invoker);
grant all on public.orden_compra_items_pendientes, public.v_comparador_precios, public.v_facturas_pendientes,
  public.v_presupuestos_completos to anon;

-- 3. Funciones (12 tenían permiso para public; delete_manual_invoice y delete_presupuesto_safe solo para anon)
grant execute on function
  public.aprender_equivalencias(uuid, uuid, jsonb),
  public.cerrar_saldo_oc(uuid, uuid, boolean, text),
  public.change_pr_operator(uuid, uuid, uuid),
  public.check_listas_vencidas(),
  public.check_presupuestos_vencidos(),
  public.generar_recordatorios_eventos(),
  public.get_balance_projection(uuid),
  public.get_dashboard_kpis(),
  public.get_dashboard_kpis(uuid),
  public.increment_stock(uuid, integer),
  public.nc_compra_disponible(uuid),
  public.normalizar_items_oc(uuid, jsonb)
to public;
grant execute on function
  public.aprender_equivalencias(uuid, uuid, jsonb),
  public.cerrar_saldo_oc(uuid, uuid, boolean, text),
  public.change_pr_operator(uuid, uuid, uuid),
  public.check_listas_vencidas(),
  public.check_presupuestos_vencidos(),
  public.delete_manual_invoice(uuid),
  public.delete_presupuesto_safe(uuid),
  public.generar_recordatorios_eventos(),
  public.get_balance_projection(uuid),
  public.get_dashboard_kpis(),
  public.get_dashboard_kpis(uuid),
  public.increment_stock(uuid, integer),
  public.nc_compra_disponible(uuid),
  public.normalizar_items_oc(uuid, jsonb)
to anon;

-- 4. Archivos (Storage)
drop policy if exists "Public read comprobantes" on storage.objects;
create policy "Public read comprobantes" on storage.objects for select to anon using (bucket_id = 'comprobantes');
drop policy if exists "public read facturas-compra" on storage.objects;
create policy "public read facturas-compra" on storage.objects for select to public using (bucket_id = 'facturas-compra');
drop policy if exists "auth insert facturas-compra" on storage.objects;
create policy "auth insert facturas-compra" on storage.objects for insert to public with check (bucket_id = 'facturas-compra');
drop policy if exists "auth update facturas-compra" on storage.objects;
create policy "auth update facturas-compra" on storage.objects for update to public using (bucket_id = 'facturas-compra');

commit;
