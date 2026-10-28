-- Prueba de 20261028140000_proveedores_cuit_solo_numeros.sql (SOLO LECTURA). Las 3 filas tienen que dar ok = true.
select 'ningún proveedor activo con guiones o espacios en el CUIT' as que,
  not exists (select 1 from public.proveedores where activo and cuit ~ '\D') as ok
union all
select 'las 2 fichas repetidas quedaron inactivas',
  (select count(*) from public.proveedores where id in ('de2b1c8d-8c9c-42c0-9b13-2eb0631274cb', '6b06d5bd-5786-4d30-9fa8-d1a6847269ff') and not activo) = 2
union all
select 'no quedan CUIT repetidos entre proveedores activos de una sociedad',
  not exists (select 1 from public.proveedores where activo and cuit is not null and cuit <> ''
    group by sociedad_id, regexp_replace(cuit, '\D', '', 'g') having count(*) > 1);
