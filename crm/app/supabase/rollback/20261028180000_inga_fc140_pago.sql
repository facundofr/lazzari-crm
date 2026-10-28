-- Vuelta atrás de 20261028180000: borra solo el pago que agregó esa migración.
begin;
delete from public.movimientos where factura_compra_id = '89a24301-74b1-4ffe-b64c-383b94dc7bc7' and tipo = 'pago'
  and descripcion like 'Pago — INGA NATALIA — FC 00002-00000140%';
commit;
