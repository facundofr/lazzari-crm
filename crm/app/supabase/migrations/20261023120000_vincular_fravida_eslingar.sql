-- Fravida y Eslingar (Delta Plus) ↔ nombre en la lista de costos (catalogo_crm.csv) — 23/10/2026, confirmado por Augusto.
--   Fravida  = FRANCISCO VICENTE DAMIANO S.A., CUIT 30500600183.
--   Delta Plus = ESLINGAR, CUIT 30701753832 (hay que darlo de alta primero en Proveedores; si no existe, esta migración no le hace nada).
-- Solo AGREGA vínculos y pone el nombre de fantasía si estaba vacío. No borra nada. Se puede correr más de una vez.
-- Vuelta atrás: supabase/rollback/20261023120000_vincular_fravida_eslingar.sql
begin;

create temp table lz_map (lista text, cuit text) on commit drop;
insert into lz_map values
  ('Fravida',    '30500600183'),
  ('Delta Plus', '30701753832');

-- Vínculos (uno por sociedad donde el proveedor exista).
insert into catalogo_proveedores (sociedad_id, proveedor_lista, proveedor_id)
select p.sociedad_id, m.lista, p.id
from lz_map m
join proveedores p on regexp_replace(coalesce(p.cuit, ''), '\D', '', 'g') = m.cuit and p.activo
on conflict (sociedad_id, proveedor_lista) do update set proveedor_id = excluded.proveedor_id;

-- Nombre de fantasía (solo si estaba vacío).
update proveedores p set nombre_fantasia = m.lista, updated_at = now()
from lz_map m
where regexp_replace(coalesce(p.cuit, ''), '\D', '', 'g') = m.cuit and p.activo and coalesce(trim(p.nombre_fantasia), '') = '';

-- Qué quedó (para mirar antes de seguir).
select s.nombre as sociedad, cp.proveedor_lista, p.razon_social, p.cuit, p.nombre_fantasia
from catalogo_proveedores cp
join proveedores p on p.id = cp.proveedor_id
join sociedades s on s.id = cp.sociedad_id
where cp.proveedor_lista in ('Fravida', 'Delta Plus')
order by cp.proveedor_lista, s.nombre;

commit;
