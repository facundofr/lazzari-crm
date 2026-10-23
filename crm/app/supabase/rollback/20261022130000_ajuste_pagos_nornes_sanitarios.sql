update facturas_compra set estado = 'pagada'
where id = 'cf2cc2dd-572f-48bf-a94e-ca4eb5d6fec0' and estado = 'pendiente';
delete from saldos_favor_proveedor where id = '5a1f0c52-8b6e-4c3a-9d7e-22102026aa01';
