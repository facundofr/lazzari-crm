-- Vuelta atrás de 20261026201000_resto_synertech_pr1218.sql: saca el resto de Synertech si sigue pendiente.
begin;
delete from public.presupuesto_restos_facturar
where presupuesto_id = '0ee2ed36-a24f-4967-ba55-9d3f5b8cb078'
  and factura_id = '54b77805-1d94-4862-8390-2803660e2238'
  and estado = 'pendiente';
commit;
