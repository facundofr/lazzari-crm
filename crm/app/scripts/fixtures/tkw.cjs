// Caso real TKW (facturas A 00002-00036697 y 00036698; OC 1187, 1188, 1192, 1199, 1204).
// Necesita parseVariant para armar las equivalencias esperadas.
module.exports = function tkw(parseVariant) {
// ── OC (descripciones como las escriben los vendedores) ──
  let n = 0;
  const oc = (ocNumero, ocFecha, descripcion, cantidad, precio) => ({ id: `${ocNumero}-${++n}`, ocId: ocNumero, ocNumero, ocFecha, descripcion, cantidad, precio });
  const ocs = [
    oc("1187", "2026-10-02", "Pampero Mameluco Grafa Azul Marino 52", 3, 37329.46),
    oc("1187", "2026-10-02", "Pampero Mameluco Grafa Azul Marino 54", 5, 37329.46),
    oc("1187", "2026-10-02", "Pampero Mameluco Grafa Azul Marino 56", 6, 37329.46),
    oc("1187", "2026-10-02", "Pampero Pantalón Cargo Ripstop Beige 42", 10, 36150),
    oc("1187", "2026-10-02", "Pampero Pantalón Cargo Ripstop Beige 48", 14, 36150),
    oc("1187", "2026-10-02", "Pampero Pantalón Cargo Ripstop Beige 50", 2, 36150),
    oc("1187", "2026-10-02", "Pampero Pantalón Cargo Ripstop Beige 52", 8, 36150),
    oc("1187", "2026-10-02", "Pampero Pantalón Cargo Ripstop Beige 54", 4, 36150),
    oc("1187", "2026-10-02", "Pampero Remera M/C Gris Mel. S/CH", 6, 11112),
    oc("1187", "2026-10-02", "Pampero Remera M/C Gris Mel. M/M", 12, 11112),
    oc("1187", "2026-10-02", "Pampero Remera M/C Gris Mel. L/G", 6, 11112),
    oc("1187", "2026-10-02", "Pampero Remera M/C Gris Mel. 3XL/2MG", 2, 11112),
    oc("1187", "2026-10-02", "Pampero Remera M/C Gris Mel. 4XL/3MG", 2, 11112),
    oc("1188", "2026-09-29", "CAMISA OXFORD CELESTE - PAMPERO (HOMBRE) - TALLE XL", 2, 21646),
    oc("1188", "2026-09-29", "CAMISA OXFORD CELESTE - PAMPERO (MUJER) - TALLE L", 2, 21646),
    oc("1188", "2026-09-29", "PANTALON CARGO ELASTIZAZDO BEIGE - PAMPERO - TALLE 40", 2, 33823),
    oc("1188", "2026-09-29", "PANTALON CARGO ELASTIZAZDO BEIGE - PAMPERO - TALLE 44", 2, 33823),
    oc("1188", "2026-09-29", "CAMISA OXFORD CELESTE - PAMPERO (MUJER) - TALLE M (SIN BORDADO)", 1, 21646),
    oc("1188", "2026-09-29", "CAMISA OXFORD CELESTE - PAMPERO (MUJER) - TALLE L (SIN BORDADO)", 1, 21646),
    oc("1192", "2026-09-25", "CAMISA OXFORD CELESTE - PAMPERO (HOMBRE) - TALLE XL", 2, 21646),
    oc("1192", "2026-09-25", "CAMISA OXFORD CELESTE - PAMPERO (MUJER) - TALLE S", 2, 21646),
    oc("1192", "2026-09-25", "PANTALON CARGO ELASTIZAZDO BEIGE - PAMPERO - TALLE 48", 2, 33823),
    ...["40", "42", "44", "48", "58"].map((s, i) => oc("1199", "2026-10-06", `PANTALON CARGO RIPSTOP RECTO T${s}`, [2, 2, 8, 10, 4][i], 33669)),
    ...[["TM", 6], ["TL", 14], ["TXL", 12], ["T2XL", 4], ["T3XL", 2], ["T4L", 2]].map(([s, q]) => oc("1199", "2026-10-06", `REMERA MANGA CORTA ALGODON PAMPERO ${s}`, q, 10600)),
    oc("1199", "2026-10-06", "PANTALON CARGO RIPSTOP RECTO T38", 2, 33669),
    ...["52", "54", "56", "58", "60", "62", "64"].map(s => oc("1199", "2026-10-06", `MAMELUCO DE TRABAJO PAMPERO C/REFL T${s}`, 2, 30000)),
    oc("1204", "2026-10-07", "CAMISA CAIRO UV BEIGE - PAMPERO - TALLE S", 2, 37259),
    oc("1204", "2026-10-07", "CAMISA CAIRO UV BEIGE - PAMPERO - TALLE M", 2, 37259),
    oc("1204", "2026-10-07", "PANTALON CARGO ELASTIZAZDO BEIGE - PAMPERO TALLE 42", 4, 33823),
  ];
  
  // ── Facturas ──
  let k = 0;
  const fl = (facturaRef, codigo, descripcion, cantidad, precio) => ({ key: `L${++k}`, facturaRef, codigo, descripcion, cantidad, precio });
  const f97 = [
    ...[["38", 2], ["40", 2], ["42", 2], ["44", 8], ["48", 10]].map(([s, q]) => fl("36697", `P24BE${s}`, `Pampero Pantalón Cargo Ripstop Beige ${s}`, q, 36149.58)),
    fl("36697", "P24BE58", "Pampero Pantalón Cargo Ripstop Beige 58", 4, 39764.63),
    ...[["2XL/MMG", 4], ["3XL/2MG", 2], ["4XL/3MG", 2], ["L/G", 14], ["M/M", 6], ["XL/MG", 12]].map(([s, q]) => fl("36697", "P01GM", `Pampero Remera M/C Gris Mel. ${s}`, q, 11112.13)),
  ];
  const f98 = [
    fl("36698", "P15DCEL", "Pampero Camisa Oxford Dama Celeste L", 3, 28392),
    fl("36698", "P15DCEM", "Pampero Camisa Oxford Dama Celeste M", 1, 28392),
    fl("36698", "P15DCES", "Pampero Camisa Oxford Dama Celeste S", 2, 28392),
    fl("36698", "P15HCEXL", "Pampero Camisa Oxford H. m/l Celeste XL/MG", 4, 21646),
    fl("36698", "P16ARM", "Pampero Camisa Cairo Arena M", 2, 37529),
    fl("36698", "P16ARS", "Pampero Camisa Cairo Arena S", 2, 37529),
    ...[["40", 2], ["42", 4], ["44", 2], ["48", 2]].map(([s, q]) => fl("36698", `P21BE${s}`, `Pampero Pantalón Cargo Fit Ela Beige ${s}`, q, 33823)),
    ...[["52", 3], ["54", 5], ["56", 6]].map(([s, q]) => fl("36698", `P70AM${s}`, `Pampero Mameluco Grafa Azul Marino ${s}`, q, 32653)),
    ...[["42", 10], ["48", 14], ["50", 2], ["52", 8], ["54", 4]].map(([s, q]) => fl("36698", `P24BE${s}`, `Pampero Pantalón Cargo Ripstop Beige ${s}`, q, 36150)),
    ...[["3XL/2MG", 2], ["4XL/3MG", 2], ["L/G", 6], ["M/M", 12], ["S/CH", 6]].map(([s, q]) => fl("36698", "P01GM", `Pampero Remera M/C Gris Mel. ${s}`, q, 11112)),
    ...["52", "54", "56", "60"].map(s => fl("36698", `P70AM${s}`, `Pampero Mameluco Grafa Azul Marino ${s}`, 2, 37329.46)),
    ...["62", "64"].map(s => fl("36698", `P70AM${s}`, `Pampero Mameluco Grafa Azul Marino ${s}`, 2, 41062.71)),
  ];
  const invoice = [...f97, ...f98];
  
  // Equivalencias de producto como las propondría la IA (o el usuario la primera vez).
  const p = d => parseVariant(d).producto;
  const eq = {
    [p("Pampero Pantalón Cargo Ripstop Beige 40")]: [p("PANTALON CARGO RIPSTOP RECTO T40"), p("Pampero Pantalón Cargo Ripstop Beige 42")],
    [p("Pampero Remera M/C Gris Mel. M/M")]: [p("REMERA MANGA CORTA ALGODON PAMPERO TM"), p("Pampero Remera M/C Gris Mel. M/M")],
    [p("Pampero Camisa Oxford Dama Celeste L")]: [p("CAMISA OXFORD CELESTE - PAMPERO (MUJER) - TALLE L"), p("CAMISA OXFORD CELESTE - PAMPERO (MUJER) - TALLE L (SIN BORDADO)")],
    [p("Pampero Camisa Oxford H. m/l Celeste XL/MG")]: [p("CAMISA OXFORD CELESTE - PAMPERO (HOMBRE) - TALLE XL")],
    [p("Pampero Camisa Cairo Arena M")]: [p("CAMISA CAIRO UV BEIGE - PAMPERO - TALLE M")],
    [p("Pampero Pantalón Cargo Fit Ela Beige 40")]: [p("PANTALON CARGO ELASTIZAZDO BEIGE - PAMPERO - TALLE 40"), p("PANTALON CARGO ELASTIZAZDO BEIGE - PAMPERO TALLE 42")],
    [p("Pampero Mameluco Grafa Azul Marino 52")]: [p("Pampero Mameluco Grafa Azul Marino 52"), p("MAMELUCO DE TRABAJO PAMPERO C/REFL T52")],
  };
  
  
  return { ocs, invoice, f97, f98, eq };
};
