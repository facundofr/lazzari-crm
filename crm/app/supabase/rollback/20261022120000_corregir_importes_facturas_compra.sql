-- Vuelta atras de 20261022120000_corregir_importes_facturas_compra.sql
update facturas_compra set subtotal = 498994.88, iva = 105504.00, percepciones = 0, total = 604498.88,
  notas = nullif(replace(notas, E'Importes corregidos 22/10/2026 segun PDF (antes total 604.498,88).', ''), '')
where id = 'cf2cc2dd-572f-48bf-a94e-ca4eb5d6fec0' and total = 638713.45;

update facturas_compra set subtotal = 824748.56, iva = 173197.20, percepciones = 25732.16, total = 1023677.92,
  notas = nullif(replace(notas, E'Importes corregidos 22/10/2026 segun PDF, con bonificacion 22 % (antes total 1.023.677,92).', ''), '')
where id = 'e0a092d0-e059-4719-acce-378837265e9e' and total = 804129.86;

update facturas_compra set iva = 6405.00, total = 67405.00,
  notas = nullif(replace(notas, E'IVA corregido 22/10/2026 segun PDF (antes IVA 6.405 y total 67.405).', ''), '')
where id = '313fc4f1-2c0a-4583-9d41-65000cd8f5f3' and total = 73810.00;
