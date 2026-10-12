-- Revisión de cobros viejos (12/10/2026) — SOLO LECTURA: no cambia nada.
-- Busca lo que pudieron dejar mal las funciones de cobro de Manu antes de la migración 20261012140000.
-- Correr en el SQL Editor de Supabase y pasarle el resultado a Claude. Una sola fila de resultado (JSON).
select jsonb_build_object(

  -- 1) Cobros masivos con varios medios: todo quedó atado a un solo medio (si rebota otro cheque, la factura sigue "pagada").
  'cobros_atados_a_un_medio', (
    select coalesce(jsonb_agg(x order by x->>'fecha'), '[]'::jsonb) from (
      select jsonb_build_object(
        'movimiento_id', m.id, 'fecha', m.fecha, 'cliente', c.razon_social, 'tipo', m.tipo, 'moneda', m.moneda,
        'monto_medio', m.monto, 'aplicado_a_facturas', sum(ca.monto),
        'descripcion', left(m.descripcion, 160)
      ) as x
      from public.movimientos m
      join public.cobro_aplicaciones ca on ca.movimiento_id = m.id
      left join public.clientes c on c.id = m.cliente_id
      where not coalesce(m.anulado, false)
        and m.liquidacion_fx_id is null
      group by m.id, c.razon_social
      having sum(ca.monto) > m.monto + 0.01
    ) t
  ),

  -- 2) Facturas cobradas de más: el pago de más quedó escondido adentro de la factura (no se ve como saldo a favor).
  'facturas_cobradas_de_mas', (
    select coalesce(jsonb_agg(x order by x->>'fecha'), '[]'::jsonb) from (
      select jsonb_build_object(
        'factura_id', f.id, 'fecha', f.fecha, 'cliente', c.razon_social,
        'comprobante', f.tipo || ' ' || lpad(f.punto_venta::text, 4, '0') || '-' || lpad(f.numero::text, 8, '0'),
        'moneda', f.moneda, 'total', f.total, 'nc', coalesce(f.total_acreditado, 0), 'cobrado', k.cobrado,
        'de_mas', round(k.cobrado + coalesce(f.total_acreditado, 0) - f.total, 2), 'estado', f.estado
      ) as x
      from public.facturas f
      left join public.clientes c on c.id = f.cliente_id
      cross join lateral (
        select
          coalesce((select sum(m.monto) from public.movimientos m
                    where m.factura_id = f.id and not coalesce(m.anulado, false)
                      and not exists (select 1 from public.cobro_aplicaciones a where a.movimiento_id = m.id)), 0)
          + coalesce((select sum(a.monto) from public.cobro_aplicaciones a join public.movimientos m on m.id = a.movimiento_id
                      where a.factura_id = f.id and not coalesce(m.anulado, false)), 0) as cobrado
      ) k
      where f.estado <> 'anulada'
        and not upper(coalesce(f.tipo::text, '')) like 'NC%'
        and k.cobrado + coalesce(f.total_acreditado, 0) > f.total + 0.01
    ) t
  ),

  -- 3) Cobros masivos de facturas en dólares grabados con los pesos como si fueran dólares.
  'cobros_usd_en_pesos', (
    select coalesce(jsonb_agg(x order by x->>'fecha'), '[]'::jsonb) from (
      select jsonb_build_object(
        'movimiento_id', m.id, 'fecha', m.fecha, 'cliente', c.razon_social, 'tipo', m.tipo,
        'monto_grabado_como_usd', m.monto, 'descripcion', left(m.descripcion, 160)
      ) as x
      from public.movimientos m
      left join public.clientes c on c.id = m.cliente_id
      where m.moneda = 'USD'
        and m.factura_id is null
        and m.cliente_id is not null
        and m.liquidacion_fx_id is null
        and m.descripcion like '%Facturas:%'
        and not coalesce(m.anulado, false)
    ) t
  ),

  -- 4) Facturas con estado "vencida" guardado en la base (antes no se podían cobrar).
  'facturas_vencidas_en_base', (
    select count(*) from public.facturas where estado = 'vencida'
  )
) as resultado;
