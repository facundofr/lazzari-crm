import { facturadoMesNeto } from "../src/lib/facturado-mes";
import assert from "node:assert/strict";

const filas = [
  { id: "a", fecha: "2026-10-05", tipo: "FA", estado: "emitida", moneda: "ARS", subtotal: 1000, total: 1210 },
  { id: "b", fecha: "2026-10-10", tipo: "FB", estado: "emitida", moneda: "ARS", subtotal: 500, total: 605 },
  { id: "c", fecha: "2026-10-12", tipo: "NCA", estado: "emitida", moneda: "ARS", subtotal: 200, total: 242, factura_origen_id: "a" },
  { id: "d", fecha: "2026-10-14", tipo: "FA", estado: "emitida", moneda: "USD", subtotal: 100, total: 121, tipo_cambio: 1500 },
  // factura de septiembre anulada + su NC de octubre: desaparecen juntas
  { id: "e", fecha: "2026-09-25", tipo: "FA", estado: "anulada", moneda: "ARS", subtotal: 8000, total: 9680 },
  { id: "f", fecha: "2026-10-14", tipo: "NCA", estado: "emitida", moneda: "ARS", subtotal: 8000, total: 9680, factura_origen_id: "e" },
  // septiembre normal
  { id: "g", fecha: "2026-09-03", tipo: "FA", estado: "emitida", moneda: "ARS", subtotal: 300, total: 363 },
  { id: "h", fecha: "2026-09-20", tipo: "FA", estado: "emitida", moneda: "ARS", subtotal: 900, total: 1089 },
  // sin subtotal: usa total
  { id: "i", fecha: "2026-10-01", tipo: "X", estado: "emitida", moneda: "ARS", subtotal: null, total: 50 },
];
const oct = facturadoMesNeto(filas, "2026-10");
assert.equal(oct.ARS.facturas, 1550);           // 1000 + 500 + 50
assert.equal(oct.ARS.nc, 200);                  // la NC de la anulada no resta
assert.equal(oct.ARS.neto, 1350);
assert.equal(oct.USD.neto, 100);
assert.equal(oct.equivalenteARS, 1350 + 150000);
const sep = facturadoMesNeto(filas, "2026-09");
assert.equal(sep.ARS.neto, 1200);               // la anulada no suma
const sep14 = facturadoMesNeto(filas, "2026-09", { hastaDia: 14 });
assert.equal(sep14.ARS.neto, 300);              // mismo tramo: solo hasta el día 14
// NC de una factura anulada que no vino en las filas, pero sí en idsAnulados
const solo = facturadoMesNeto(filas.filter((f) => f.id !== "e"), "2026-10", { idsAnulados: ["e"] });
assert.equal(solo.ARS.nc, 200);
console.log("test-facturado-mes OK");
