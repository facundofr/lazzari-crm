-- Auditoría integral, Tanda 5 — H31 (29/10/2026, OK de Augusto): anular y revertir una factura de venta SIN CAE en una sola
-- transacción, en la base (antes era un cambio de estado directo desde la pantalla, sin mirar cobros, NC ni PR).
--  * anular: la factura queda "anulada". Lo que ya estaba cobrado no se pierde: queda A FAVOR del cliente (un ajuste
--    crédito por cada cobro, atado al cobro en cobro_origen_id, igual que un cobro de más). Si su PR ya no tiene otra
--    factura vigente, el PR vuelve a "facturar". Si tenía NC aplicadas, avisa (no las toca).
--  * revertir: la factura vuelve a "emitida", se anulan esos ajustes a favor (el cobro vuelve a la factura), se recalcula
--    el estado por lo cobrado (parcial / pagada) y el PR vuelve a "facturado".
-- Nunca frena por cobros: avisa. Solo frena lo que no corresponde (tiene CAE, es una NC, ya está en ese estado).
-- Aditivo: solo agrega una función. Vuelta atrás: supabase/rollback/20261029110000_anular_factura_manual.sql
begin;

create or replace function public.gestionar_factura_manual(p_factura_id uuid, p_accion text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_f public.facturas%rowtype;
  v_comp text;
  v_avisos jsonb := '[]'::jsonb;
  v_cobro record;
  v_a_favor numeric := 0;
  v_ajustes integer := 0;
  v_otras integer;
  v_pr_estado text;
  v_estado text;
  v_marca text;
begin
  if auth.uid() is null then
    raise exception 'Sesión no válida';
  end if;
  if p_accion not in ('anular', 'revertir') then
    raise exception 'Acción inválida' using errcode = '22023';
  end if;

  select * into v_f from public.facturas where id = p_factura_id for update;
  if not found then
    raise exception 'La factura ya no existe';
  end if;
  if not public.lz_puede_operar_finanzas(v_f.sociedad_id) then
    raise exception 'No tenés permiso para anular facturas en esta sociedad' using errcode = '42501';
  end if;
  if coalesce(v_f.cae, '') <> '' then
    raise exception 'La factura tiene CAE: se anula con una nota de crédito, no desde acá' using errcode = '22023';
  end if;
  if v_f.tipo::text like 'NC%' then
    raise exception 'Una nota de crédito no se anula desde acá' using errcode = '22023';
  end if;

  v_comp := v_f.tipo::text || ' ' || lpad(coalesce(v_f.punto_venta, 0)::text, 4, '0') || '-' || lpad(coalesce(v_f.numero, 0)::text, 8, '0');
  -- Marca para encontrar los ajustes a favor que genera esta anulación (y anularlos si se revierte).
  v_marca := 'Saldo a favor: cobro de la ' || v_comp || ' anulada';

  if p_accion = 'anular' then
    if v_f.estado::text = 'anulada' then
      raise exception 'La factura ya está anulada';
    end if;

    -- Cobros vigentes de la factura: directos (factura_id, sin aplicaciones) y aplicaciones de cobros consolidados.
    for v_cobro in
      select m.id, m.monto as importe, m.moneda::text as moneda, m.cliente_id
      from public.movimientos m
      where m.factura_id = p_factura_id and not coalesce(m.anulado, false)
        and m.tipo::text <> 'ajuste'
        and not exists (select 1 from public.cobro_aplicaciones ca where ca.movimiento_id = m.id)
      union all
      select m.id, ca.monto as importe, coalesce(v_f.moneda::text, 'ARS') as moneda, m.cliente_id
      from public.cobro_aplicaciones ca
      join public.movimientos m on m.id = ca.movimiento_id
      where ca.factura_id = p_factura_id and not coalesce(m.anulado, false)
    loop
      if coalesce(v_cobro.importe, 0) <= 0.005 then continue; end if;
      insert into public.movimientos (tipo, cliente_id, factura_id, descripcion, monto, moneda, fecha, conciliado, created_by, sociedad_id, ajuste_sentido, cobro_origen_id)
      values ('ajuste'::public.movimiento_tipo, coalesce(v_cobro.cliente_id, v_f.cliente_id), null, v_marca,
              round(v_cobro.importe, 2), coalesce(v_cobro.moneda, v_f.moneda::text, 'ARS')::public.moneda_type, current_date, false, auth.uid(),
              v_f.sociedad_id, 'credito', v_cobro.id);
      v_a_favor := v_a_favor + round(v_cobro.importe, 2);
      v_ajustes := v_ajustes + 1;
    end loop;

    update public.facturas set estado = 'anulada'::public.factura_status where id = p_factura_id;

    if v_ajustes > 0 then
      v_avisos := v_avisos || to_jsonb('Tenía ' || to_char(v_a_favor, 'FM999G999G999G990D00') || ' cobrados: quedan a favor del cliente en su cuenta corriente.');
    end if;
    if coalesce(v_f.total_acreditado, 0) > 0.005 then
      v_avisos := v_avisos || to_jsonb('Tenía notas de crédito aplicadas por ' || to_char(v_f.total_acreditado, 'FM999G999G999G990D00') || ': revisalas, no se tocaron.');
    end if;

    -- El PR vuelve a "facturar" si no le queda otra factura vigente.
    if v_f.presupuesto_id is not null then
      select count(*) into v_otras from public.facturas
      where presupuesto_id = v_f.presupuesto_id and id <> p_factura_id and estado::text <> 'anulada' and tipo::text not like 'NC%';
      select estado::text into v_pr_estado from public.presupuestos where id = v_f.presupuesto_id for update;
      if v_otras = 0 and v_pr_estado = 'facturado' then
        update public.presupuestos set estado = 'facturar' where id = v_f.presupuesto_id;
        v_avisos := v_avisos || to_jsonb('El presupuesto volvió a "Facturar".'::text);
      end if;
    end if;

  else -- revertir
    if v_f.estado::text <> 'anulada' then
      raise exception 'La factura no está anulada';
    end if;

    -- Se anulan los ajustes a favor que generó la anulación: el cobro vuelve a esta factura.
    update public.movimientos
    set anulado = true, monto_original = monto, monto = 0, anulado_at = now(), anulado_por = auth.uid(), conciliado = false,
        descripcion = '[ANULADO · se revirtió la anulación] ' || descripcion
    where ajuste_sentido = 'credito' and not coalesce(anulado, false) and descripcion = v_marca and sociedad_id = v_f.sociedad_id;
    get diagnostics v_ajustes = row_count;

    update public.facturas set estado = 'emitida'::public.factura_status where id = p_factura_id;
    v_estado := public.lz_estado_factura_por_cobro(p_factura_id);

    if v_ajustes > 0 then
      v_avisos := v_avisos || to_jsonb('Los cobros que habían quedado a favor del cliente volvieron a esta factura.'::text);
    end if;

    if v_f.presupuesto_id is not null then
      select estado::text into v_pr_estado from public.presupuestos where id = v_f.presupuesto_id for update;
      if v_pr_estado = 'facturar' then
        update public.presupuestos set estado = 'facturado' where id = v_f.presupuesto_id;
        v_avisos := v_avisos || to_jsonb('El presupuesto volvió a "Facturado".'::text);
      end if;
    end if;
  end if;

  select estado::text into v_estado from public.facturas where id = p_factura_id;
  return jsonb_build_object('ok', true, 'accion', p_accion, 'factura_id', p_factura_id, 'estado', v_estado, 'avisos', v_avisos);
end;
$$;

revoke all on function public.gestionar_factura_manual(uuid, text) from public, anon;
grant execute on function public.gestionar_factura_manual(uuid, text) to authenticated;
comment on function public.gestionar_factura_manual(uuid, text) is
  'Auditoría H31: anular / revertir la anulación de una factura de venta sin CAE, en una transacción (cobros a favor del cliente, PR a facturar / facturado).';

commit;
