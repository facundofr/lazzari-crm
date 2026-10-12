-- Vuelta atrás de 20261012210000_pendientes_proveedores_augusto.sql: saca solo esas 5 filas (si siguen pendientes).
begin;
delete from finanzas_revisar
where sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and titulo like 'Proveedores: %' and created_at::date = '2026-10-12' and estado = 'pendiente';
commit;
