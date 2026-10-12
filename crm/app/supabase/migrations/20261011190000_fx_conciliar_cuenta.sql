-- Los movimientos de una liquidación en USD (cobros/pagos de facturas en dólares) están protegidos:
-- solo se podía cambiar "conciliado" y "extracto_movimiento_id". El cruce con el extracto (etapa 2)
-- además guarda la cuenta y quién/cuándo concilió, y fallaba con "Anulá y registrá nuevamente la liquidación".
-- Se permiten también cuenta_id, conciliado_at y conciliado_por (no son datos de plata).
-- Vuelta atrás: supabase/rollback/20261011190000_fx_conciliar_cuenta.sql
begin;

create or replace function public.proteger_movimiento_fx() returns trigger language plpgsql as $$
begin
 if tg_op='INSERT' then
  if new.liquidacion_fx_id is not null and current_user in ('authenticated','anon') then raise exception 'Use liquidar_documentos_fx'; end if;
  return new;
 end if;
 if tg_op='UPDATE' and new.liquidacion_fx_id is distinct from old.liquidacion_fx_id then raise exception 'No se puede cambiar la liquidación de un movimiento'; end if;
 if old.liquidacion_fx_id is not null and coalesce(current_setting('app.fx_anular',true),'')<>old.liquidacion_fx_id::text then
  if tg_op='DELETE' then raise exception 'Anulá la liquidación completa; no se pueden borrar sus movimientos'; end if;
  if (to_jsonb(new)-'conciliado'-'extracto_movimiento_id'-'conciliado_at'-'conciliado_por'-'cuenta_id')
     is distinct from (to_jsonb(old)-'conciliado'-'extracto_movimiento_id'-'conciliado_at'-'conciliado_por'-'cuenta_id') then
   raise exception 'Anulá y registrá nuevamente la liquidación para corregirla';
  end if;
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;

commit;
