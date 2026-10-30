-- José Rodríguez (Rosario): proveedor nuevo en Lazzari con el tilde Transporte. Pedido de Augusto 29/10/2026.
-- El trigger sync_transportista_desde_proveedor lo une al transportista "JOSE RODRIGUEZ" que ya existe (por nombre, sin CUIT)
-- y le completa el CUIT; sus 2 viajes quedan en el mismo transportista. Aditivo.
-- Vuelta atrás: supabase/rollback/20261029140000_proveedor_jose_rodriguez.sql
begin;
insert into public.proveedores (id, sociedad_id, razon_social, cuit, condicion_iva, rubro, es_transportista,
  concepto_retencion_ganancias, medio_pago_preferido, medios_pago, notas)
select '7c2e51a4-3b9d-4f60-a1d8-29102026b0c4', 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021', 'JOSE RODRIGUEZ', '20313644074', 'Monotributo',
  'Transporte', true, 'transporte', 'transferencia', '{transferencia}',
  'Transporte (Rosario). Condición de IVA y datos bancarios a confirmar.'
where not exists (select 1 from public.proveedores where regexp_replace(coalesce(cuit, ''), '\D', '', 'g') = '20313644074'
  and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021');
commit;
