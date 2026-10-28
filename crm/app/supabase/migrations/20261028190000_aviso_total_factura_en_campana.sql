-- 28/10/2026: la Finanzas vieja (y su pantalla Revisar) se sacó del sistema. El aviso de "total cambiado en una factura de compra ya pagada de más"
-- (20261028161000) iba a finanzas_revisar, que ya no tiene pantalla: ahora va a la campana (alertas). Sigue sin frenar nada.
-- Aditivo: reemplaza solo la función del trigger. Vuelta atrás: supabase/rollback/20261028190000_aviso_total_factura_en_campana.sql
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
    insert into public.alertas (tipo, title, description, entity_id, entity_type, module, user_id, sociedad_id, read)
    values (
      'seguimiento',
      'FC ' || coalesce(new.numero_factura, '') || ': total cambiado, ya estaba pagada de más',
      left('El total pasó de ' || old.total || ' a ' || new.total || ' y las órdenes de pago ya aplicaron ' || v_aplicado || '. Revisá si quedó saldo a favor del proveedor.', 500),
      new.id, 'factura_compra', 'finanzas', null, new.sociedad_id, false
    );
  end if;
  return new;
end;
$$;

commit;
