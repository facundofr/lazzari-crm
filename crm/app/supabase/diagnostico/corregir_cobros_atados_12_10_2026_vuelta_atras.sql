-- Vuelta atrás de corregir_cobros_atados_12_10_2026.sql: deja las aplicaciones como estaban (desde el respaldo).
begin;

do $$
declare
  v_r record;
  v_medio record;
  v_sufijo text;
begin
  for v_r in
    select * from public.lz_respaldo_correcciones
    where migracion = 'corregir_cobros_atados_12_10_2026' and tabla = 'cobro_aplicaciones'
  loop
    select * into v_medio from public.movimientos where id = v_r.registro_id;
    v_sufijo := substring(v_medio.descripcion from '— Facturas: .*$');

    -- Saca las aplicaciones que se les dieron a las retenciones de ese cobro.
    delete from public.cobro_aplicaciones a
    using public.movimientos m
    where m.id = a.movimiento_id
      and m.cliente_id = v_medio.cliente_id
      and m.sociedad_id = v_medio.sociedad_id
      and m.fecha = v_medio.fecha
      and m.tipo::text like 'retencion%'
      and m.factura_id is null
      and m.descripcion like '%' || v_sufijo;

    -- Vuelve a poner las del medio como estaban.
    delete from public.cobro_aplicaciones where movimiento_id = v_r.registro_id;
    insert into public.cobro_aplicaciones (movimiento_id, factura_id, monto)
    select v_r.registro_id, (x->>'factura_id')::uuid, (x->>'monto')::numeric
    from jsonb_array_elements(v_r.datos_anteriores->'aplicaciones') x;

    delete from public.lz_respaldo_correcciones where id = v_r.id;
  end loop;
end $$;

commit;
