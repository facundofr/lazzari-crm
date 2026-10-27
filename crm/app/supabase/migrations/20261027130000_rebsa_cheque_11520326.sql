-- Rebsa (27/10/2026, Augusto: "acá tenés lo de rebsa para corregir", con la OP 0001-00010132 de Rebsa y el comprobante
-- de eCheqs del Banco Provincia): el cobro del 27/10 (recibo 1078, FA 0015-00000085) cargó sus dos eCheqs con el
-- N° 11520327 y pago el 07/11/2026. Según los dos PDF, el segundo es el N° 11520326 y se paga el 23/11/2026
-- (su detalle ya decía «Ref: 11520326»). Con el mismo N° e importe, el reporte de eCheq no los podía cruzar.
-- Solo cambia ese cheque (por su id): N° y fecha de pago. No toca el cobro, el recibo ni la factura.
-- Si el cheque no está como se cargó, no cambia nada (tira error).
-- Vuelta atrás: supabase/rollback/20261027130000_rebsa_cheque_11520326.sql
begin;

do $$
begin
  if not exists (
    select 1 from public.echeqs
    where id = '0c48b49d-dc42-4ada-8f81-dd855cc55b44' and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021'
      and direccion = 'recibido' and numero = '11520327' and fecha_pago = '2026-11-07' and monto = 269104.00
      and movimiento_id = 'c1da91de-208a-43b1-84a3-ab48342bf1ba' and observaciones like '%Ref: 11520326%'
  ) then raise exception 'El segundo cheque de Rebsa no está como se cargó el 27/10 (N° 11520327, pago 07/11, $ 269.104, «Ref: 11520326»): no se cambia nada'; end if;

  if exists (select 1 from public.echeqs where sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and numero = '11520326') then
    raise exception 'Ya hay un cheque con el N° 11520326: no se cambia nada';
  end if;
end $$;

update public.echeqs set numero = '11520326', fecha_pago = '2026-11-23'
  where id = '0c48b49d-dc42-4ada-8f81-dd855cc55b44' and numero = '11520327' and fecha_pago = '2026-11-07';

commit;
