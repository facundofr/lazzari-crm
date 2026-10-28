-- Seguridad, Tanda 1 Parte A (auditoría integral 28/10/2026, hallazgos H01-H04; Augusto: "Sí, prepará la A").
-- Cierra lo que se podía leer o tocar SIN entrar al CRM (rol anon, con la clave pública que baja cualquier navegador):
--   1. Cotización del dólar: el anónimo ya no la puede cargar ni cambiar (verla sigue igual).
--   2. Vistas: el anónimo ya no las lee, y las 7 sin security_invoker pasan a respetar los permisos de cada usuario.
--      Ninguna pantalla usa esas 7 (solo lib/supabase/queries, que no importa nadie); la que sí se usa
--      (orden_compra_items_pendientes) ya tenía security_invoker.
--   3. Funciones: 14 funciones ya no las ejecuta el anónimo. Los usuarios logueados y el servidor (crons) siguen igual.
--   4. Archivos: se sacan los permisos que dejaban listar comprobantes y facturas de compra, y subir o pisar facturas
--      de compra, sin login. Los usuarios logueados tienen sus propios permisos (no se tocan) y los links públicos
--      ya mandados siguen andando (los buckets siguen públicos; eso es la Parte D).
-- No borra datos ni cambia tablas: solo permisos.
-- Vuelta atrás: supabase/rollback/20261028120000_seguridad_cerrar_anonimo.sql
-- Prueba: scripts/db/pruebas/seguridad_cerrar_anonimo.sql (solo lectura)
begin;

-- 1. Cotización del dólar
drop policy if exists cotiz_insert_anon on public.cotizaciones_dolar;
drop policy if exists cotiz_update_anon on public.cotizaciones_dolar;
revoke insert, update, delete, truncate, references, trigger on public.cotizaciones_dolar from anon;

-- 2. Vistas
alter view public.v_comparador_precios set (security_invoker = true);
alter view public.v_cuenta_corriente_clientes set (security_invoker = true);
alter view public.v_cuenta_corriente_proveedores set (security_invoker = true);
alter view public.v_facturas_pendientes set (security_invoker = true);
alter view public.v_ordenes_compra_progreso set (security_invoker = true);
alter view public.v_presupuestos_completos set (security_invoker = true);
alter view public.v_stock_alertas set (security_invoker = true);
revoke all on public.orden_compra_items_pendientes, public.v_comparador_precios, public.v_facturas_pendientes,
  public.v_presupuestos_completos from anon;

-- 3. Funciones (se saca a public y anon; se deja explícito a authenticated y service_role)
revoke execute on function
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
from public, anon;
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
to authenticated, service_role;

-- 4. Archivos (Storage)
drop policy if exists "Public read comprobantes" on storage.objects;
drop policy if exists "public read facturas-compra" on storage.objects;
drop policy if exists "auth insert facturas-compra" on storage.objects;
drop policy if exists "auth update facturas-compra" on storage.objects;

commit;
