-- Corrige 2 cobros viejos (función de Manu) que dejaron sus retenciones "colgadas" del medio de pago (12/10/2026).
--   · DEL SOL CONSTRUCTORA, cheque 3881 (30/09/2026): $3.677.887,22 aplicado como $3.739.700,45.
--   · TERMO CORDOBA, transferencia (05/10/2026): $181.135,41 aplicado como $186.340,00.
-- La diferencia son las retenciones de ese mismo cobro. Se pasan a su propia aplicación, factura por factura (más vieja primero),
-- así cada factura queda con EXACTAMENTE lo mismo cobrado (no cambia ningún estado ni saldo). Si después rebota el cheque,
-- la retención sigue valiendo y la deuda vuelve solo por el cheque.
--
-- Seguridad: si algo no coincide al centavo, se corta con un error y NO se cambia nada.
-- Respaldo de lo anterior en lz_respaldo_correcciones (migracion = 'corregir_cobros_atados_12_10_2026').
-- Vuelta atrás: corregir_cobros_atados_12_10_2026_vuelta_atras.sql
begin;

do $$
declare
  v_medio_id uuid;
  v_medio record;
  v_aplicado numeric;
  v_dif numeric;
  v_sufijo text;
  v_ret record;
  v_suma_ret numeric;
  v_ap record;
  v_resto numeric;
  v_mover numeric;
  v_antes jsonb;
  v_despues jsonb;
begin
  foreach v_medio_id in array array[
    '5066f916-e5e1-44f3-befc-75d1cf7f9544'::uuid,  -- DEL SOL, cheque 3881
    '4b466730-48f5-41b9-ac57-82cc7e4d9c45'::uuid   -- TERMO CORDOBA, transferencia
  ]
  loop
    if exists (select 1 from public.lz_respaldo_correcciones
               where migracion = 'corregir_cobros_atados_12_10_2026' and registro_id = v_medio_id) then
      raise notice 'Ya corregido antes: %', v_medio_id;
      continue;
    end if;

    select * into v_medio from public.movimientos where id = v_medio_id for update;
    if not found or coalesce(v_medio.anulado, false) then
      raise exception 'El cobro % no existe o está anulado: no se cambia nada', v_medio_id;
    end if;

    select coalesce(sum(monto), 0) into v_aplicado from public.cobro_aplicaciones where movimiento_id = v_medio_id;
    v_dif := round(v_aplicado - v_medio.monto, 2);
    if v_dif <= 0 then
      raise exception 'El cobro % ya no tiene diferencia: no se cambia nada', v_medio_id;
    end if;

    -- Retenciones del mismo cobro: mismo cliente, sociedad y fecha, misma lista de facturas, sin factura ni aplicaciones propias.
    v_sufijo := substring(v_medio.descripcion from '— Facturas: .*$');
    select coalesce(sum(m.monto), 0) into v_suma_ret
    from public.movimientos m
    where m.cliente_id = v_medio.cliente_id
      and m.sociedad_id = v_medio.sociedad_id
      and m.fecha = v_medio.fecha
      and m.tipo::text like 'retencion%'
      and m.factura_id is null
      and not coalesce(m.anulado, false)
      and v_sufijo is not null
      and m.descripcion like '%' || v_sufijo
      and not exists (select 1 from public.cobro_aplicaciones a where a.movimiento_id = m.id);

    if abs(v_suma_ret - v_dif) > 0.01 then
      raise exception 'Cobro %: la diferencia es % pero las retenciones encontradas suman %. No se cambia nada.', v_medio_id, v_dif, v_suma_ret;
    end if;

    -- Cobrado por factura antes (para comprobar que no cambia).
    select jsonb_object_agg(factura_id, total) into v_antes
    from (select factura_id, sum(monto) total from public.cobro_aplicaciones
          where movimiento_id = v_medio_id or movimiento_id in (
            select m.id from public.movimientos m
            where m.cliente_id = v_medio.cliente_id and m.sociedad_id = v_medio.sociedad_id and m.fecha = v_medio.fecha
              and m.tipo::text like 'retencion%' and m.factura_id is null and m.descripcion like '%' || v_sufijo)
          group by factura_id) t;

    -- Respaldo.
    insert into public.lz_respaldo_correcciones (migracion, tabla, registro_id, datos_anteriores)
    select 'corregir_cobros_atados_12_10_2026', 'cobro_aplicaciones', v_medio_id,
           jsonb_build_object('aplicaciones', jsonb_agg(jsonb_build_object('factura_id', a.factura_id, 'monto', a.monto)))
    from public.cobro_aplicaciones a where a.movimiento_id = v_medio_id;

    -- Mover cada retención: de la factura más vieja a la más nueva.
    for v_ret in
      select m.id, m.monto
      from public.movimientos m
      where m.cliente_id = v_medio.cliente_id
        and m.sociedad_id = v_medio.sociedad_id
        and m.fecha = v_medio.fecha
        and m.tipo::text like 'retencion%'
        and m.factura_id is null
        and not coalesce(m.anulado, false)
        and m.descripcion like '%' || v_sufijo
        and not exists (select 1 from public.cobro_aplicaciones a where a.movimiento_id = m.id)
      order by m.monto desc, m.id
    loop
      v_resto := v_ret.monto;
      for v_ap in
        select a.ctid as fila, a.factura_id, a.monto
        from public.cobro_aplicaciones a
        join public.facturas f on f.id = a.factura_id
        where a.movimiento_id = v_medio_id and a.monto > 0
        order by f.fecha, f.punto_venta, f.numero
      loop
        exit when v_resto <= 0;
        v_mover := least(v_resto, v_ap.monto);
        update public.cobro_aplicaciones set monto = round(monto - v_mover, 2) where ctid = v_ap.fila;
        insert into public.cobro_aplicaciones (movimiento_id, factura_id, monto) values (v_ret.id, v_ap.factura_id, round(v_mover, 2));
        v_resto := round(v_resto - v_mover, 2);
      end loop;
      if v_resto > 0.01 then
        raise exception 'Cobro %: no alcanzó para ubicar la retención %. No se cambia nada.', v_medio_id, v_ret.id;
      end if;
    end loop;

    -- Aplicaciones que quedaron en $0 (ya respaldadas): se sacan para que no molesten al editar el cobro.
    delete from public.cobro_aplicaciones where movimiento_id = v_medio_id and monto = 0;

    -- Comprobaciones finales.
    select coalesce(sum(monto), 0) into v_aplicado from public.cobro_aplicaciones where movimiento_id = v_medio_id;
    if abs(v_aplicado - v_medio.monto) > 0.01 then
      raise exception 'Cobro %: el medio quedó con % aplicado y debería ser %. No se cambia nada.', v_medio_id, v_aplicado, v_medio.monto;
    end if;
    select jsonb_object_agg(factura_id, total) into v_despues
    from (select factura_id, sum(monto) total from public.cobro_aplicaciones
          where movimiento_id = v_medio_id or movimiento_id in (
            select m.id from public.movimientos m
            where m.cliente_id = v_medio.cliente_id and m.sociedad_id = v_medio.sociedad_id and m.fecha = v_medio.fecha
              and m.tipo::text like 'retencion%' and m.factura_id is null and m.descripcion like '%' || v_sufijo)
          group by factura_id) t;
    if v_antes is distinct from v_despues then
      raise exception 'Cobro %: cambiaría lo cobrado de alguna factura (antes %, después %). No se cambia nada.', v_medio_id, v_antes, v_despues;
    end if;

    raise notice 'Corregido %: retenciones % pasadas a su propia aplicación.', v_medio_id, v_dif;
  end loop;
end $$;

-- Cómo quedó (para mirar).
select c.razon_social as cliente, m.tipo, m.monto as monto_movimiento, sum(a.monto) as aplicado
from public.movimientos m
join public.cobro_aplicaciones a on a.movimiento_id = m.id
left join public.clientes c on c.id = m.cliente_id
where m.id in ('5066f916-e5e1-44f3-befc-75d1cf7f9544', '4b466730-48f5-41b9-ac57-82cc7e4d9c45')
   or m.id in (select a2.movimiento_id from public.cobro_aplicaciones a2
               join public.movimientos m2 on m2.id = a2.movimiento_id
               where m2.tipo::text like 'retencion%'
                 and m2.cliente_id in (select cliente_id from public.movimientos
                                       where id in ('5066f916-e5e1-44f3-befc-75d1cf7f9544', '4b466730-48f5-41b9-ac57-82cc7e4d9c45')))
group by c.razon_social, m.id, m.tipo, m.monto
order by 1, 2;

commit;
