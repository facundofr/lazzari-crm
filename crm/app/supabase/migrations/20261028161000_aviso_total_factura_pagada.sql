-- H22 (auditoría integral): al cambiar el total de una factura de compra que ya tiene pagos aplicados por más que el nuevo total,
-- queda un aviso en Finanzas > Hoy > Revisar. NUNCA frena el cambio: solo avisa.
-- Aditivo: una función y un trigger nuevos. Vuelta atrás: supabase/rollback/20261028161000_aviso_total_factura_pagada.sql
begin;

create or replace function public.lz_aviso_total_factura_pagada()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_aplicado numeric;
begin
  if new.total is not distinct from old.total then
    return new;
  end if;
  select coalesce(sum(a.monto), 0) into v_aplicado
  from public.op_facturas_compra a
  join public.ordenes_pago o on o.id = a.orden_pago_id
  where a.factura_compra_id = new.id and o.estado <> 'anulada';
  if v_aplicado > coalesce(new.total, 0) + 0.01 then
    insert into public.finanzas_revisar (sociedad_id, entidad_tipo, entidad_id, titulo, motivo, nota, importe, moneda, proveedor_id)
    values (
      new.sociedad_id, 'factura_compra', new.id,
      'FC ' || coalesce(new.numero_factura, '') || ': total cambiado, ya estaba pagada de más',
      'total_cambiado_pagada',
      'El total pasó de ' || old.total || ' a ' || new.total || ' y las órdenes de pago ya aplicaron ' || v_aplicado || '. Revisá si quedó saldo a favor del proveedor.',
      round(v_aplicado - new.total, 2),
      case when new.moneda = 'USD' then 'USD' else 'ARS' end,
      new.proveedor_id
    );
  end if;
  return new;
end;
$$;

drop trigger if exists lz_aviso_total_factura_pagada on public.facturas_compra;
create trigger lz_aviso_total_factura_pagada
  after update of total on public.facturas_compra
  for each row execute function public.lz_aviso_total_factura_pagada();

commit;
