select descripcion, monto, moneda, fecha, proveedor_id is not null con_prov from public.gastos_manuales where notas like '%gastos-fijos-octubre-2026%' order by descripcion;
