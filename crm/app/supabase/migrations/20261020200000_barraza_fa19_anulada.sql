-- BARRAZA JESICA PAOLA: FA 0015-00000019 pasa a "anulada" (Augusto 20/10/2026).
-- La NC A 0001-00000025 (hecha en ARCA, 30/09) anula las FA 0015-00000010, 0015-00000019 y 0015-00000030.
-- La 10 y la 30 ya estaban anuladas; la 19 quedó "pagada" porque su cheque (N° 00000131) sigue depositado.
-- El cobro de ese cheque NO se toca: si rebota, el rechazo anula el cobro y gestionar_cobro deja la factura "anulada".
-- Solo datos, una fila. Vuelta atrás: supabase/rollback/20261020200000_barraza_fa19_anulada.sql
update public.facturas
set estado = 'anulada'
where id = (
  select f.id from public.facturas f
  join public.clientes c on c.id = f.cliente_id
  where f.sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021'
    and f.tipo = 'FA' and f.punto_venta = 15 and f.numero = 19
    and c.razon_social ilike '%barraza%'
)
and estado = 'pagada';
