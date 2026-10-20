-- Mateo Perrone / Muises (encomiendas): proveedor nuevo en Lazzari, marcado como transportista,
-- y el transportista "MATEO PERRONE" con sus datos. Pedido de Augusto 18/10/2026.
-- Vuelta atrás: supabase/rollback/20261018130000_proveedor_mateo_perrone.sql
begin;
insert into public.proveedores (id, sociedad_id, razon_social, nombre_fantasia, cuit, condicion_iva, email, telefono,
  alias_bancario, tipo_cuenta, cuit_titular_cuenta, rubro, es_transportista, concepto_retencion_ganancias,
  medio_pago_preferido, medios_pago, notas)
select '5a7e0c11-8d2b-4e61-9c3f-18102026a7e0', 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021', 'MATEO PERRONE MUISES', 'Encomiendas Mateo',
  '20452221951', 'Monotributo', 'Mateomuises72@gmail.com', '2477 451298',
  'Encomiendasmateo', 'CA', '20452221951', 'Transporte', true, 'transporte',
  'transferencia', '{transferencia}', 'Encomiendas. Mateo Perrone (también Muises). Condición de IVA a confirmar con su factura.'
where not exists (select 1 from public.proveedores where cuit = '20452221951' and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021');

update public.transportistas set razon_social = 'MATEO PERRONE MUISES', cuit = '20452221951', email = 'Mateomuises72@gmail.com',
  observaciones = 'Proveedor: MATEO PERRONE MUISES (Encomiendas Mateo).'
where id = 'd9ef3b98-1f9f-45e1-9017-072a55166c85';
commit;
