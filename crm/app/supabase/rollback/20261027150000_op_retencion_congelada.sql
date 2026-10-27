-- Vuelta atrás de 20261027150000_op_retencion_congelada.sql: saca las cuatro columnas de ordenes_pago y movimientos.
-- Las OP y los pagos no cambian; solo se pierde lo anotado (régimen, mínimo y pagos anteriores del mes): el TXT, el Excel
-- y el certificado vuelven a usar el concepto de hoy del proveedor. Correr antes la vuelta atrás de los datos
-- (20261027151000_op_retencion_congelada_datos.sql) no hace falta: esta borra las columnas enteras.
alter table public.ordenes_pago drop constraint if exists ordenes_pago_retencion_ganancias_regimen_check;
alter table public.movimientos drop constraint if exists movimientos_retencion_ganancias_regimen_check;
alter table public.ordenes_pago drop column if exists retencion_ganancias_retenido_antes;
alter table public.ordenes_pago drop column if exists retencion_ganancias_base_previa;
alter table public.ordenes_pago drop column if exists retencion_ganancias_minimo;
alter table public.ordenes_pago drop column if exists retencion_ganancias_regimen;
alter table public.movimientos drop column if exists retencion_ganancias_retenido_antes;
alter table public.movimientos drop column if exists retencion_ganancias_base_previa;
alter table public.movimientos drop column if exists retencion_ganancias_minimo;
alter table public.movimientos drop column if exists retencion_ganancias_regimen;
