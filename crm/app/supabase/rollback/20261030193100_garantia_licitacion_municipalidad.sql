-- Vuelta atrás de 20261030193100_garantia_licitacion_municipalidad.sql: la línea del 27/10 vuelve a como estaba (pendiente).
begin;

update public.extracto_movimientos e
   set estado = r.estado, clasificacion = r.clasificacion, subtipo = r.subtipo, match_movimiento_id = r.match_movimiento_id,
       nota = r.nota, clasificado_por = r.clasificado_por, clasificado_at = r.clasificado_at
  from public.lz_backup_garantia_municipalidad_20261030 b, jsonb_populate_record(null::public.extracto_movimientos, b.fila) r
 where e.id = r.id;

commit;
