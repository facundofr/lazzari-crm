-- Vuelta atras de 20261014200000: deja vacias las observaciones de la FA 0015-00000066.
begin;
update public.facturas set observaciones = null
where tipo = 'FA' and punto_venta = 15 and numero = 66 and cae = '86417671388996'
  and observaciones = 'PO 9900098904 - SES 2026/1011106066';
commit;
