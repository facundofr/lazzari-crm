// npx tsx scripts/test-ventas-documentos.ts
// B7 (NC restada dos veces) y elección de factura en el cobro por orden de pago.
import assert from "node:assert/strict";
import { importeVentaNeto, totalVentasNeto, esNotaCredito, letraComprobante, elegirFacturaDeOrdenPago } from "../src/lib/ventas-documentos";

// ── B7 ──
const docs = [
  { id: "f1", tipo: "FA", total: 1000, estado: "emitida" },
  { id: "f2", tipo: "FB", total: 500, estado: "anulada" },             // anulada por su NC total
  { id: "nc2", tipo: "NCB", total: 500, estado: "emitida", factura_origen_id: "f2" },
  { id: "f3", tipo: "FA", total: 800, estado: "pagada" },
  { id: "nc3", tipo: "NCA", total: 200, estado: "emitida", factura_origen_id: "f3" }, // NC parcial
  { id: "nc4", tipo: "NCA", total: 50, estado: "emitida" },             // NC suelta
  { id: "nc5", tipo: "NCA", total: 70, estado: "anulada", factura_origen_id: "f1" },
];
const estado = new Map(docs.map(d => [d.id, d.estado]));
assert.equal(importeVentaNeto(docs[0]), 1000);
assert.equal(importeVentaNeto(docs[1]), 0);
assert.equal(importeVentaNeto(docs[2], "anulada"), 0, "NC de factura anulada no resta otra vez");
assert.equal(importeVentaNeto(docs[4], "pagada"), -200);
assert.equal(importeVentaNeto(docs[5], null), -50);
assert.equal(importeVentaNeto(docs[6], "emitida"), 0, "NC anulada no resta");
// 1000 + 800 − 200 − 50 = 1550 (antes daba 1050: la NC de f2 se restaba aunque f2 ya no sumaba)
assert.equal(totalVentasNeto(docs, id => estado.get(id)), 1550);
// Si la factura origen no está en la lista (otro mes), la NC resta normalmente.
assert.equal(totalVentasNeto([docs[4]], () => undefined), -200);

assert.equal(esNotaCredito("NCEB"), true);
assert.equal(esNotaCredito("FA"), false);
assert.equal(esNotaCredito(null), false);

// ── Letras ──
assert.equal(letraComprobante("FA"), "A");
assert.equal(letraComprobante("FCEB"), "B");
assert.equal(letraComprobante("Factura A"), "A");
assert.equal(letraComprobante("FC B 0001-00000045"), "B");
assert.equal(letraComprobante("0001-00000045"), null);
assert.equal(letraComprobante(""), null);

// ── Cobro por OP: nunca una NC, y desempata por letra ──
const cands = [
  { id: "nc", tipo: "NCA", estado: "emitida" },
  { id: "fa", tipo: "FA", estado: "emitida" },
];
assert.equal(elegirFacturaDeOrdenPago(cands)?.id, "fa", "excluye la NC con el mismo número");
assert.equal(elegirFacturaDeOrdenPago([{ id: "nc", tipo: "NCB", estado: "emitida" }]), undefined);
assert.equal(elegirFacturaDeOrdenPago([{ id: "x", tipo: "FA", estado: "anulada" }]), undefined);
const dos = [{ id: "fa", tipo: "FA", estado: "emitida" }, { id: "fb", tipo: "FB", estado: "emitida" }];
assert.equal(elegirFacturaDeOrdenPago(dos, "FB")?.id, "fb");
assert.equal(elegirFacturaDeOrdenPago(dos, null, "Factura B 0003-00000012")?.id, "fb");
assert.equal(elegirFacturaDeOrdenPago(dos)?.id, "fa");

console.log("test-ventas-documentos OK");
