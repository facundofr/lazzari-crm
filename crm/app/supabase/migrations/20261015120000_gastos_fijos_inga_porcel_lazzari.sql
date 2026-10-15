-- 15/10/2026 — ADITIVA (solo agrega filas; no toca ni borra nada existente).
-- Para deshacer: supabase/rollback/20261015120000_gastos_fijos_inga_porcel_lazzari.sql
--
-- Natalia Inga (consultora, US$ 1.100) y Leandro Porcel (coaching empresarial, $ 500.000) se pagaban con Grupo LA;
-- desde ahora los paga Lazzari y facturan a Lazzari. Esto:
--  1. Copia los 2 proveedores de Grupo LA a Lazzari (mismos datos de CUIT, CBU, alias y retención; saldo de cuenta corriente en 0).
--  2. Crea los 2 gastos fijos en Lazzari (vencen el día 10), vinculados a esos proveedores.
-- Se puede correr más de una vez: no duplica.

begin;

insert into public.proveedores (
  razon_social, cuit, condicion_iva, email, telefono, direccion, localidad, provincia, rubro, forma_pago,
  dias_cuenta_corriente, limite_credito, saldo_cuenta_corriente, notas, activo, sociedad_id,
  concepto_retencion_ganancias, alicuota_ganancias, cbu, alias_bancario, numero_cuenta,
  medios_pago, medio_pago_preferido, tolerancia_precio_pct
)
select
  p.razon_social, p.cuit, p.condicion_iva, p.email, p.telefono, p.direccion, p.localidad, p.provincia, p.rubro, p.forma_pago,
  p.dias_cuenta_corriente, p.limite_credito, 0, p.notas, true, 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021',
  p.concepto_retencion_ganancias, p.alicuota_ganancias, p.cbu, p.alias_bancario, p.numero_cuenta,
  p.medios_pago, p.medio_pago_preferido, p.tolerancia_precio_pct
from public.proveedores p
where p.sociedad_id = 'fee94607-747a-4e87-ba24-aff9032f7a56'
  and p.id in ('940ddf62-ee3d-4998-b489-95e19d950d2b', '9fd87ebd-d408-42bf-aff6-7685d1394b07')
  and not exists (
    select 1 from public.proveedores x
    where x.sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and x.cuit = p.cuit
  );

insert into public.gastos_fijos (descripcion, categoria, monto, moneda, dia_vencimiento, notas, sociedad_id, proveedor_id, activo)
select 'Natalia Inga (consultora)', 'Profesionales', 1100, 'USD', 10,
       'Vence el 10. Se transfiere en pesos al tipo de cambio del dólar billete. Factura a Lazzari.',
       'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021', p.id, true
from public.proveedores p
where p.sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and p.cuit = '27237546321'
  and not exists (select 1 from public.gastos_fijos g where g.sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and g.descripcion = 'Natalia Inga (consultora)');

insert into public.gastos_fijos (descripcion, categoria, monto, moneda, dia_vencimiento, notas, sociedad_id, proveedor_id, activo)
select 'Leandro Porcel (coaching empresarial)', 'Profesionales', 500000, 'ARS', 10,
       'Vence el 10. Factura a Lazzari.',
       'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021', p.id, true
from public.proveedores p
where p.sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and p.cuit = '20253118807'
  and not exists (select 1 from public.gastos_fijos g where g.sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and g.descripcion = 'Leandro Porcel (coaching empresarial)');

commit;
