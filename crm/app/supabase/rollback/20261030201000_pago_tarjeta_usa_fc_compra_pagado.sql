-- Vuelta atrás de 20261030201000_pago_tarjeta_usa_fc_compra_pagado.sql: deja registrar_pago_tarjeta_factura_compra
-- como estaba (cálculo propio del saldo, de 20261013220000). Los pagos ya registrados quedan.
begin;

create or replace function public.registrar_pago_tarjeta_factura_compra(p_factura_id uuid, p_cuenta_id uuid)
returns jsonb
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_user uuid := auth.uid();
  f public.facturas_compra%rowtype;
  v_cuenta text;
  v_prov text;
  v_pagado numeric;
  v_monto numeric;
  v_mov uuid;
begin
  select * into f from public.facturas_compra where id = p_factura_id for update;
  if not found then raise exception 'No existe la factura' using errcode = '23503'; end if;
  if v_user is null
    or not exists (select 1 from public.profiles where id = v_user and active and role::text in ('super_admin','admin','administrativo','vendedor'))
    or not exists (select 1 from public.user_sociedades where user_id = v_user and sociedad_id = f.sociedad_id)
  then
    raise exception 'No tenés autorización para registrar pagos en esta sociedad' using errcode = '42501';
  end if;
  if upper(coalesce(f.tipo_comprobante, '')) like 'NC%' or f.estado = 'anulada' then
    raise exception 'Solo se registran pagos de facturas vigentes' using errcode = '22023';
  end if;
  select c.nombre into v_cuenta from public.cuentas_financieras c
  where c.id = p_cuenta_id and c.sociedad_id = f.sociedad_id and c.tipo = 'tarjeta_credito'
    and (c.uso = 'trabajo' or exists (select 1 from public.profiles pr where pr.id = v_user and pr.role::text in ('super_admin','admin','administrativo')));
  if v_cuenta is null then raise exception 'La tarjeta no es de esta sociedad' using errcode = '22023'; end if;

  -- Ya pagada (OP vigente o pago directo): no se duplica.
  select coalesce((select sum(l.monto) from public.op_facturas_compra l join public.ordenes_pago o on o.id = l.orden_pago_id
                   where l.factura_compra_id = f.id and o.estado <> 'anulada'), 0)
       + coalesce((select sum(coalesce(m.monto, 0) + coalesce(m.retencion_ganancias_monto, 0)) from public.movimientos m
                   where m.factura_compra_id = f.id and m.tipo::text = 'pago' and not coalesce(m.anulado, false)), 0)
       + coalesce(f.total_acreditado, 0)
    into v_pagado;
  v_monto := round(coalesce(f.total, 0) - v_pagado, 2);
  if v_monto <= 0.005 then
    update public.facturas_compra set estado = 'pagada' where id = f.id and estado <> 'pagada';
    return jsonb_build_object('movimiento_id', null, 'monto', 0, 'ya_pagada', true);
  end if;

  select coalesce(p.nombre_fantasia, p.razon_social) into v_prov from public.proveedores p where p.id = f.proveedor_id;
  insert into public.movimientos (tipo, sociedad_id, proveedor_id, factura_compra_id, cuenta_id, monto, moneda, fecha, descripcion, created_by)
  values ('pago', f.sociedad_id, f.proveedor_id, f.id, p_cuenta_id, v_monto, coalesce(f.moneda, 'ARS')::public.moneda_type, f.fecha,
          left('Pago con ' || v_cuenta || ' — ' || coalesce(f.tipo_comprobante, 'FC') || ' ' || coalesce(f.numero_factura, 'S/N')
               || coalesce(' — ' || v_prov, ''), 250), v_user)
  returning id into v_mov;
  update public.facturas_compra set estado = 'pagada' where id = f.id;
  return jsonb_build_object('movimiento_id', v_mov, 'monto', v_monto, 'tarjeta', v_cuenta);
end $$;

revoke all on function public.registrar_pago_tarjeta_factura_compra(uuid, uuid) from public, anon;
grant execute on function public.registrar_pago_tarjeta_factura_compra(uuid, uuid) to authenticated;

commit;
