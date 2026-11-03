-- Prueba de 20261103150000: cuántos remitos tomaron "Lo llevamos nosotros" o el transportista de su viaje,
-- y que todo remito con viaje vigente muestre lo mismo que su viaje.
select
  (select count(*) from public.remitos where entrega_propia) as remitos_propios,
  (select count(*) from public.lz_remitos_entrega_antes) as respaldados,
  (select count(*) from public.remitos r join public.transportes t on t.remito_id = r.id
     where t.estado <> 'cancelado' and t.tipo = 'interno' and not r.entrega_propia) as interno_sin_marcar,
  (select count(*) from public.remitos r join public.transportes t on t.remito_id = r.id
     where t.estado <> 'cancelado' and t.tipo <> 'interno' and r.transportista_id is null) as externo_sin_transportista,
  (select string_agg(r.numero || ' = ' || x.nombre, ', ' order by r.numero) from public.remitos r join public.transportistas x on x.id = r.transportista_id
     where r.numero in ('R-2026-1038', 'R-2026-1070', 'R-2026-1086')) as casos;
