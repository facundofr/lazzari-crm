-- Ajuste por facturas mal cargadas (ver 20261022120000). No se toca ninguna OP ya pagada.
-- Nornes 0004-00026223: la factura correcta es 638.713,45 y se pagaron 604.498,88 -> vuelve a "pendiente" (saldo 34.214,57) para pagarla con una OP nueva.
update facturas_compra set estado = 'pendiente'
where id = 'cf2cc2dd-572f-48bf-a94e-ca4eb5d6fec0' and estado = 'pagada' and total = 638713.45;

-- Sanitarios San Martin: se transfirio de mas (neto 1.011.148,31 vs 795.229,14 que correspondia) -> saldo a favor de 215.919,17 ligado a OP-000047.
insert into saldos_favor_proveedor (id, sociedad_id, proveedor_id, orden_pago_id, moneda, monto_original, saldo, estado, created_by)
select '5a1f0c52-8b6e-4c3a-9d7e-22102026aa01', 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021', '37594ee5-fb09-4685-b7b5-ce91cf90d917',
       'ac48c744-6d28-4c1b-90af-9cc89b38384e', 'ARS', 215919.17, 215919.17, 'disponible', 'cb8fdf3e-d171-4042-9da7-248fe863b96d'
where not exists (select 1 from saldos_favor_proveedor where id = '5a1f0c52-8b6e-4c3a-9d7e-22102026aa01');
