-- Prueba de 20261013210000_datos_pagos_visa_8_facturas.sql: los 8 pagos y cuánto suman.
select count(*) as pagos, sum(monto) as total, string_agg(left(descripcion, 70), ' | ') as detalle
from movimientos where descripcion like '%[carga 13/10/2026]' and not coalesce(anulado, false);
