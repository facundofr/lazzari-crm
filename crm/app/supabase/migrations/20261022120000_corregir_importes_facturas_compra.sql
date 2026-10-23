-- Corrige importes mal tomados de 3 facturas de compra (se verificaron contra el PDF).
-- Solo cambia subtotal, iva, percepciones, total y agrega una nota. No toca pagos, OP ni estados.
-- Cada UPDATE solo corre si la factura todavia tiene el total viejo (si ya se corrigio a mano, no hace nada).

-- Nornes 0004-00026223: faltaba el recargo (14.969,85) y la percepcion IIBB (19.959,80)
update facturas_compra set subtotal = 513964.73, iva = 104788.92, percepciones = 19959.80, total = 638713.45,
  notas = concat_ws(E'\n', nullif(notas, ''), 'Importes corregidos 22/10/2026 segun PDF (antes total 604.498,88).')
where id = 'cf2cc2dd-572f-48bf-a94e-ca4eb5d6fec0' and total = 604498.88;

-- Sanitarios San Martin 0007-00024709: no se habia restado la bonificacion del 22 %
update facturas_compra set subtotal = 643303.88, iva = 135093.82, percepciones = 25732.16, total = 804129.86,
  notas = concat_ws(E'\n', nullif(notas, ''), 'Importes corregidos 22/10/2026 segun PDF, con bonificacion 22 % (antes total 1.023.677,92).')
where id = 'e0a092d0-e059-4719-acce-378837265e9e' and total = 1023677.92;

-- Mollon 0003-00017481: IVA al 21 %, no 10,5 %
update facturas_compra set iva = 12810.00, total = 73810.00,
  notas = concat_ws(E'\n', nullif(notas, ''), 'IVA corregido 22/10/2026 segun PDF (antes IVA 6.405 y total 67.405).')
where id = '313fc4f1-2c0a-4583-9d41-65000cd8f5f3' and total = 67405.00;
