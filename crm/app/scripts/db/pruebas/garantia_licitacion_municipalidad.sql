-- Prueba de 20261030193100_garantia_licitacion_municipalidad.sql (con --probar: siempre se deshace), con la vuelta atrás al final.
select 'linea' q, estado, clasificacion, subtipo, left(nota, 70) nota from extracto_movimientos where id = 'ca613d1f-29b9-4038-9f08-9a3aea17ce64';
-- Vuelta atrás de 20261030193100_garantia_licitacion_municipalidad.sql: la línea del 27/10 vuelve a como estaba (pendiente).

update public.extracto_movimientos e
   set estado = r.estado, clasificacion = r.clasificacion, subtipo = r.subtipo, match_movimiento_id = r.match_movimiento_id,
       nota = r.nota, clasificado_por = r.clasificado_por, clasificado_at = r.clasificado_at
  from public.lz_backup_garantia_municipalidad_20261030 b, jsonb_populate_record(null::public.extracto_movimientos, b.fila) r
 where e.id = r.id;

select 'vuelta' q, e.estado, (to_jsonb(e) = b.fila) identica from extracto_movimientos e join lz_backup_garantia_municipalidad_20261030 b on b.id = e.id;
