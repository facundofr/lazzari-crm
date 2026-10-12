-- Proveedores ↔ nombre en la lista de costos + nombre de fantasía — 12/10/2026, confirmado por Augusto uno por uno.
--
-- 1) Vincula cada proveedor (por CUIT, en las dos sociedades) con cómo figura en catalogo_crm.csv, así "Ordenar OC abiertas"
--    lo reconoce solo. 2) Le pone ese nombre como nombre de fantasía si no tenía.
-- 3) Corrige "Delta Plus": estaba atado a ESPACIO MARKETING S.R.L. y según Augusto es ESLINGAR (todavía no está cargado en el CRM).
--    Se saca ese vínculo equivocado y el nombre de fantasía "Delta Plus" de Espacio Marketing. Cuando se dé de alta Eslingar se vincula.
-- Pendientes (sin tocar): Ecoway (Augusto pasa el nombre), Fravida (sin confirmar), Pegaso = MARIANA SA (no está cargado),
--   GRUPO MASTROIANNI S.A. (otro CUIT, sin movimientos: BH Industrial queda con EUGENIO MASTROIANNI).
-- No borra proveedores ni movimientos. Vuelta atrás: supabase/rollback/20261012200000_proveedores_lista_fantasia.sql
begin;

create temp table lz_map (lista text, cuit text) on commit drop;
insert into lz_map values
  ('Prisina',      '30709905402'),
  ('TKW',          '30713315202'),
  ('Startex',      '30608543844'),
  ('FADI',         '30503675842'),
  ('Aire Libre',   '30714339172'),
  ('Mediglove',    '30707948708'),
  ('Segutécnica',  '33629040019'),
  ('Segufer',      '30678145366'),
  ('BH Industrial','20085280512'),
  ('Iturria',      '30646196155'),
  ('SPI',          '30718788990'),
  ('DPS',          '30707784292'),  -- INDUSTRIAS DE PASCALE S.A.
  ('Conoflex',     '30710599498');  -- SERENPLAS SRL

-- 3) Delta Plus mal vinculado.
delete from catalogo_proveedores cp
using proveedores p
where cp.proveedor_id = p.id and cp.proveedor_lista = 'Delta Plus' and regexp_replace(p.cuit, '\D', '', 'g') = '30712325468';
update proveedores set nombre_fantasia = null, updated_at = now()
where regexp_replace(cuit, '\D', '', 'g') = '30712325468' and nombre_fantasia = 'Delta Plus';

-- 1) Vínculos (uno por sociedad; si ya existía para esa lista, se reemplaza el proveedor).
insert into catalogo_proveedores (sociedad_id, proveedor_lista, proveedor_id)
select p.sociedad_id, m.lista, p.id
from lz_map m
join proveedores p on regexp_replace(coalesce(p.cuit, ''), '\D', '', 'g') = m.cuit and p.activo
on conflict (sociedad_id, proveedor_lista) do update set proveedor_id = excluded.proveedor_id;

-- 2) Nombre de fantasía (solo si estaba vacío).
update proveedores p set nombre_fantasia = m.lista, updated_at = now()
from lz_map m
where regexp_replace(coalesce(p.cuit, ''), '\D', '', 'g') = m.cuit and p.activo and coalesce(trim(p.nombre_fantasia), '') = '';

commit;
