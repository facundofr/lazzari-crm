-- FA 0015-00000066 (Corteva, PR-2026-1120): agrega la leyenda del cliente que va impresa en la factura — 14/10/2026, pedido de Augusto.
-- Solo el texto libre de la factura (no cambia importes ni CAE). Se aplica solo si observaciones sigue vacio.
-- Vuelta atras: supabase/rollback/20261014200000_fa66_observaciones_po_ses.sql
begin;
update public.facturas
set observaciones = 'PO 9900098904 - SES 2026/1011106066'
where tipo = 'FA' and punto_venta = 15 and numero = 66
  and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021'
  and cae = '86417671388996' and observaciones is null;
commit;
