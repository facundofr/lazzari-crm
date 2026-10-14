-- Datos (OK de Augusto 13/10/2026): 8 facturas de compra de Lazzari quedaron "pagada" con el tilde de tarjeta pero sin pago cargado.
-- Se registra el pago con la BBVA Visa Signature ·1582 (fecha de la factura, por el total), igual que hace ahora la carga de facturas.
-- Solo agrega movimientos; no toca las facturas. Vuelta atrás: supabase/rollback/20261013210000_datos_pagos_visa_8_facturas.sql
begin;

insert into public.movimientos (tipo, sociedad_id, proveedor_id, factura_compra_id, cuenta_id, monto, moneda, fecha, descripcion)
select 'pago', f.sociedad_id, f.proveedor_id, f.id, 'f2caa8a4-594a-4055-aea4-f2a58e953b25', f.total, coalesce(f.moneda, 'ARS')::moneda_type, f.fecha,
       'Pago con BBVA Visa Signature ·1582 — ' || coalesce(f.tipo_comprobante, 'FC') || ' ' || f.numero_factura || ' — '
       || coalesce(p.nombre_fantasia, p.razon_social) || ' [carga 13/10/2026]'
from public.facturas_compra f
join public.proveedores p on p.id = f.proveedor_id
where f.sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021'
  and f.estado = 'pagada'
  and f.numero_factura in ('0001-00007206','0003-00005573','0003-00000175','0001-00000398','0007-00004790','0003-00023345','00005-00117115','002-00005235')
  and not exists (select 1 from public.movimientos m where m.factura_compra_id = f.id and m.tipo = 'pago' and not coalesce(m.anulado, false))
  and not exists (select 1 from public.op_facturas_compra l join public.ordenes_pago o on o.id = l.orden_pago_id
                  where l.factura_compra_id = f.id and o.estado <> 'anulada');

commit;
