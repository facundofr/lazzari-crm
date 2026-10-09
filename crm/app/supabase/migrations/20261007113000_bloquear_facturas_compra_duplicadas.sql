-- Una OP puede contener dos documentos distintos con igual número e importe
-- (por ejemplo, dos viajes de transporte). La identidad contable es el id de
-- facturas_compra, no el texto visible ni el monto. Solo impedimos vincular el
-- mismo registro exacto dos veces a la misma OP.
begin;

-- Revierte la versión anterior de esta protección si alcanzó a aplicarse.
drop trigger if exists bloquear_factura_compra_duplicada on public.facturas_compra;
drop trigger if exists bloquear_factura_duplicada_en_op on public.op_facturas_compra;
drop function if exists public.bloquear_factura_compra_duplicada();
drop function if exists public.normalizar_numero_factura_compra(text);

create or replace function public.bloquear_mismo_registro_factura_en_op()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if tg_op = 'UPDATE'
    and new.orden_pago_id is not distinct from old.orden_pago_id
    and new.factura_compra_id is not distinct from old.factura_compra_id then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    new.orden_pago_id::text || ':' || new.factura_compra_id::text,
    0
  ));

  if exists (
    select 1
    from public.op_facturas_compra enlace
    where enlace.orden_pago_id = new.orden_pago_id
      and enlace.factura_compra_id = new.factura_compra_id
  ) then
    raise exception 'La misma factura ya está vinculada a esta orden de pago'
      using errcode = '23505';
  end if;

  return new;
end;
$$;

create trigger bloquear_mismo_registro_factura_en_op
before insert or update of orden_pago_id, factura_compra_id
on public.op_facturas_compra
for each row execute function public.bloquear_mismo_registro_factura_en_op();

commit;
