-- Dato A de la revisión de Finanzas (26/10/2026, chat Para confirmar BBVA): la OP-000014 de SERENPLAS SRL está cargada dos veces en movimientos.
--   - 15/09 20:03: pago $ 68.736,20 + retención de Ganancias $ 885,29, SIN la OP atada (carga vieja).
--   - 17/10 14:48: el mismo pago y la misma retención desde el script [ops8-17/10], atados a la OP-000014 y al eCheq 90017313.
-- En la cuenta corriente de SERENPLAS figura pagado $ 69.621,49 de más. Se ANULA el par viejo del 15/09 (no se borra nada).
-- El SICORE no cambia: toma la retención de la OP. Ninguna línea del banco, cheque, recibo ni cobro apunta a esos dos movimientos.
-- Si algo no está como se espera, no cambia nada (tira error).
-- Vuelta atrás: supabase/rollback/20261026120000_anular_pago_doble_serenplas.sql
begin;

do $$
declare
  v_viejos constant uuid[] := array['1037a979-f842-4524-9ccf-33e1c2bfc34a', '44942db9-d8f4-4605-900b-6440fc9ae48f']::uuid[];
  v_n integer;
begin
  select count(*) into v_n from public.movimientos
    where id = any(v_viejos) and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021'
      and proveedor_id = 'd4485d80-7bc9-419c-8cfd-6ebb10aa7f5e' and orden_pago_id is null and not coalesce(anulado, false)
      and ((tipo = 'pago' and monto = 68736.20) or (tipo = 'retencion_ganancias' and monto = 885.29));
  if v_n <> 2 then raise exception 'Se esperaban los 2 movimientos viejos del 15/09 sin anular (encontré %): no se cambia nada', v_n; end if;

  -- El par bueno (atado a la OP-000014) tiene que seguir activo.
  select count(*) into v_n from public.movimientos
    where orden_pago_id = 'e55fb27c-ae24-4ac0-a2c9-520a1ab4208d' and not coalesce(anulado, false)
      and ((tipo = 'pago' and monto = 68736.20) or (tipo = 'retencion_ganancias' and monto = 885.29));
  if v_n <> 2 then raise exception 'El pago y la retención atados a la OP-000014 no están los dos activos (encontré %): no se cambia nada', v_n; end if;

  if exists (select 1 from public.extracto_movimientos where match_movimiento_id = any(v_viejos))
    or exists (select 1 from public.echeqs where movimiento_id = any(v_viejos))
    or exists (select 1 from public.cobro_aplicaciones where movimiento_id = any(v_viejos))
    or exists (select 1 from public.recibo_movimientos where movimiento_id = any(v_viejos))
    or exists (select 1 from public.op_notas_credito_compra where movimiento_id = any(v_viejos)) then
    raise exception 'Algún movimiento viejo está atado a otra cosa (banco, cheque, cobro, recibo o NC): no se cambia nada';
  end if;
end $$;

update public.movimientos set anulado = true, anulado_at = now()
  where id in ('1037a979-f842-4524-9ccf-33e1c2bfc34a', '44942db9-d8f4-4605-900b-6440fc9ae48f')
    and not coalesce(anulado, false);

commit;
