-- Transportes, pedido de Augusto 20/10/2026. Solo datos, en Lazzari.
-- 1) "JULIO CERNUDA" pasa a "JULIO CERNUDA (Ingrid Martin)" (factura Ingrid, la cuenta es de Julio), y sus viajes también.
-- 2) Copia al contador de Transportes 5 viajes que se cargaron desde remitos ("¿Quién lo lleva?" es solo dato del remito,
--    así que esos viajes no se veían en Transportes). Los del remito NO se tocan. Cada copia lleva "Viene del remito R-…".
--    · R-2026-1038 Cáceres $14.000: con fecha 29/09 (no cae en octubre) y ya liquidado (misma factura que el del remito).
--    · R-2026-1079 y R-2026-1080 Cáceres $4.500 cada uno. (R-2026-1078 NO, por decisión de Augusto.)
--    · R-2026-1070 y R-2026-1086 Transporte Hero S.R.L., sin monto (se completa en el contador).
-- No toca los viajes viejos de Cáceres del contador.
-- Vuelta atrás: supabase/rollback/20261020160000_transportes_recuperar_viajes_remito.sql
begin;

update public.transportistas set nombre = 'JULIO CERNUDA (Ingrid Martin)'
where id = '774457dc-a0dd-4e71-9b58-c2aacfbcdb05' and nombre = 'JULIO CERNUDA';
update public.transportes set transportista = 'JULIO CERNUDA (Ingrid Martin)'
where transportista_id = '774457dc-a0dd-4e71-9b58-c2aacfbcdb05' and transportista = 'JULIO CERNUDA';

insert into public.transportes
  (id, sociedad_id, fecha, cliente_id, remito_id, transportista, transportista_id, tipo, destino, costo, moneda, estado, notas, factura_compra_id, created_by)
select c.nuevo_id::uuid, o.sociedad_id, c.fecha::date, null, null, c.nombre, c.transportista_id::uuid, 'externo', coalesce(o.destino, ''),
       o.costo, coalesce(o.moneda, 'ARS'), 'entregado', 'Viene del remito ' || c.remito, c.factura::uuid, null
from (values
  ('adedfd68-a914-4f16-a243-5b2d631b640d', '328e3042-50a8-444b-b668-77394e4b0532', '2026-09-29', 'R-2026-1038', 'CARLOS ANDRES CACERES', 'cde395e2-4348-4a03-a1e1-10ca1c3aefa4', '02b71ed5-714a-4ee3-b943-535574c0375c'),
  ('1383a886-673b-40e2-83c8-d94ea64200ab', '651edbaa-9dee-4b93-978c-bfbfd205079b', '2026-10-15', 'R-2026-1079', 'CARLOS ANDRES CACERES', 'cde395e2-4348-4a03-a1e1-10ca1c3aefa4', null),
  ('da207404-6918-4497-9841-dcda3cdf07c6', 'ec514814-1191-494f-9749-450a901682ff', '2026-10-15', 'R-2026-1080', 'CARLOS ANDRES CACERES', 'cde395e2-4348-4a03-a1e1-10ca1c3aefa4', null),
  ('20eeb271-ee8d-47eb-870b-537f406c6e99', '70e996a3-619e-429d-a021-a87152d0631d', '2026-10-13', 'R-2026-1070', 'Transporte Hero S.R.L.', '72e590b9-e882-4452-a60f-627fb49aca12', null),
  ('32d88649-44de-481c-ac25-8f5a650377d9', '5f2ce74d-a706-4cbc-b14c-d312b4ad3a16', '2026-10-16', 'R-2026-1086', 'Transporte Hero S.R.L.', '72e590b9-e882-4452-a60f-627fb49aca12', null)
) as c(nuevo_id, origen_id, fecha, remito, nombre, transportista_id, factura)
join public.transportes o on o.id = c.origen_id::uuid
on conflict (id) do nothing;

-- Control: tiene que dar 5 copias y 12 viajes con el nombre nuevo.
select
  (select count(*) from public.transportes where id in ('adedfd68-a914-4f16-a243-5b2d631b640d','1383a886-673b-40e2-83c8-d94ea64200ab','da207404-6918-4497-9841-dcda3cdf07c6','20eeb271-ee8d-47eb-870b-537f406c6e99','32d88649-44de-481c-ac25-8f5a650377d9')) as copias,
  (select count(*) from public.transportes where transportista = 'JULIO CERNUDA (Ingrid Martin)') as viajes_julio;

commit;
