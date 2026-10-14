-- Vuelta atrás de 20261013210000_datos_pagos_visa_8_facturas.sql: anula (no borra) los 8 pagos con Visa agregados.
begin;
update public.movimientos set anulado = true, anulado_at = now()
where sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and tipo = 'pago'
  and cuenta_id = 'f2caa8a4-594a-4055-aea4-f2a58e953b25' and descripcion like '%[carga 13/10/2026]';
commit;
