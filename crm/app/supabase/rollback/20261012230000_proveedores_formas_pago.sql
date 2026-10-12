-- Vuelta atrás de 20261012230000_proveedores_formas_pago.sql
-- Saca las columnas y la tabla nuevas (se pierden las condiciones de pago cargadas después). forma_pago / dias_cuenta_corriente
-- de los proveedores nunca se tocaron.
begin;

drop table if exists public.cheque_fechas_mes;

alter table public.facturas_compra
  drop column if exists condicion_pago, drop column if exists dias_pago, drop column if exists dias_pago_hasta;

alter table public.ordenes_compra
  drop column if exists condicion_pago, drop column if exists dias_pago, drop column if exists dias_pago_hasta,
  drop column if exists medio_pago_preferido, drop column if exists plazo_cheque_dias, drop column if exists descuento_pronto_pago;

alter table public.proveedores
  drop column if exists administracion_nombre, drop column if exists condicion_pago, drop column if exists dias_pago,
  drop column if exists dias_pago_hasta, drop column if exists medios_pago, drop column if exists medio_pago_preferido,
  drop column if exists plazo_cheque_dias, drop column if exists descuento_pronto_pago;

commit;
