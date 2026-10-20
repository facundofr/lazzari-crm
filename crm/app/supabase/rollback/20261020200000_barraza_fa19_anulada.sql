-- Vuelta atrás de 20261020200000_barraza_fa19_anulada.sql: la FA 0015-00000019 de BARRAZA vuelve a "pagada".
update public.facturas
set estado = 'pagada'
where id = (
  select f.id from public.facturas f
  join public.clientes c on c.id = f.cliente_id
  where f.sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021'
    and f.tipo = 'FA' and f.punto_venta = 15 and f.numero = 19
    and c.razon_social ilike '%barraza%'
)
and estado = 'anulada';
