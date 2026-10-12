-- ¿Laura (laura@lazzari.com.ar) cargó algo en el CRM? (SOLO LECTURA: no cambia nada). 12/10/2026
-- Busca su id en TODAS las columnas de tipo uuid de las tablas del CRM (created_by, user_id, vendedor_id, etc.)
-- y muestra solo donde aparece. Si no sale ninguna fila (salvo profiles), no dejó rastros.
with laura as (
  select id from auth.users where lower(email) = 'laura@lazzari.com.ar'
),
columnas as (
  select c.table_name, c.column_name
  from information_schema.columns c
  join information_schema.tables t
    on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
  where c.table_schema = 'public'
    and c.data_type = 'uuid'
),
conteos as (
  select
    col.table_name  as tabla,
    col.column_name as columna,
    (xpath('/row/c/text()', query_to_xml(
      format('select count(*) as c from public.%I where %I = %L', col.table_name, col.column_name, (select id from laura)),
      false, true, '')))[1]::text::int as cantidad
  from columnas col
)
select tabla, columna, cantidad
from conteos
where cantidad > 0
order by tabla, columna;
