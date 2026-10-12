-- Vuelta atrás de 20261011190000_fx_conciliar_cuenta.sql: vuelve a la versión de 20260912180000_fx_settlements.sql
-- (solo se puede cambiar "conciliado" y "extracto_movimiento_id" en movimientos de una liquidación USD).
-- ⚠️ Con esto, el cruce del extracto vuelve a fallar para cobros/pagos de facturas en dólares.
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
  if (to_jsonb(new)-'conciliado'-'extracto_movimiento_id') is distinct from (to_jsonb(old)-'conciliado'-'extracto_movimiento_id') then raise exception 'Anulá y registrá nuevamente la liquidación para corregirla'; end if;
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;

commit;
