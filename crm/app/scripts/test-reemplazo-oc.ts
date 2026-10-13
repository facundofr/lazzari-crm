import { equivalenciaSugerida, costoPorUnidadPR, avisoCambioCostoPR } from "../src/lib/reemplazo-oc";
const ok = (c: boolean, m: string) => { if (!c) { console.error("FALLA", m); process.exit(1); } };
// Caso real: OC-2026-1186, 10 rollos; factura Espumas Pilar 5000 m a $504.
ok(equivalenciaSugerida(5000, 10) === 500, "equivalencia 500");
ok(costoPorUnidadPR(504, 500) === 252000, "costo por rollo 252.000");
ok(equivalenciaSugerida(0, 10) === 1 && equivalenciaSugerida(10, 0) === 1, "equivalencia sin datos = 1");
ok(costoPorUnidadPR(504, 0) === 504, "equivalencia inválida = 1");
// Sin facturar: cambio chico no avisa; cambio grande sí.
ok(!avisoCambioCostoPR({ articulo: "x", costoViejo: 100, costoNuevo: 104, mismaMoneda: true, markupNuevo: 40, facturado: false }).avisar, "4 % no avisa");
const a = avisoCambioCostoPR({ articulo: "x", costoViejo: 100, costoNuevo: 110, mismaMoneda: true, markupNuevo: 40, facturado: false });
ok(a.avisar && a.variacionPct === 10 && !a.bajoMinimo, "10 % avisa");
// Markup bajo el mínimo avisa en rojo aunque el cambio sea chico.
const b = avisoCambioCostoPR({ articulo: "x", costoViejo: 100, costoNuevo: 102, mismaMoneda: true, markupNuevo: 12, facturado: false });
ok(b.avisar && b.bajoMinimo, "markup 12 % avisa en rojo");
// Facturado: siempre informativo. Moneda distinta: no compara %, avisa.
ok(avisoCambioCostoPR({ articulo: "x", costoViejo: 100, costoNuevo: 100, mismaMoneda: true, markupNuevo: 50, facturado: true }).avisar, "facturado informa");
const c = avisoCambioCostoPR({ articulo: "x", costoViejo: 100, costoNuevo: 90000, mismaMoneda: false, markupNuevo: 30, facturado: false });
ok(c.avisar && c.variacionPct === null, "moneda distinta avisa sin %");
console.log("OK reemplazo-oc");
