import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
import ts from "typescript";

const source = fs.readFileSync(new URL("../src/lib/reportes-comprobantes.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
const exports = {};
vm.runInNewContext(compiled.outputText, { exports });
const L = exports;

// NC: todos los formatos restan
for (const t of ["NCA", "NCB", "NCEA", "NCEB", "NC A", "nc", "NC"]) assert.equal(L.signoComprobante(t), -1, t);
for (const t of ["FA", "FB", "FCEA", "NDA", "FC A", "FC Manual", "", null]) assert.equal(L.signoComprobante(t), 1, String(t));

// Moneda
assert.equal(L.normalizarMoneda("USD"), "USD");
assert.equal(L.normalizarMoneda("USD Divisa"), "USD");
assert.equal(L.normalizarMoneda(null), "ARS");

// Meses sin corrimiento de zona horaria
assert.equal(L.periodoDeFecha("2026-10-01"), "2026-10");
assert.equal(L.periodoDeFecha("2026-10-01T00:00:00Z"), "2026-10");
assert.equal(L.periodoDeFecha("basura"), "");
assert.equal(L.sumarMeses("2026-01", -1), "2025-12");
assert.equal(L.sumarMeses("2026-12", 1), "2027-01");
assert.equal(L.sumarMeses("2026-10", -23), "2024-11");
assert.equal(L.inicioDeMesHace("2026-10-09", 0), "2026-10-01");
assert.equal(L.inicioDeMesHace("2026-03-31", 5), "2025-10-01");

// B7: factura anulada por su NC total → no cuenta ninguna de las dos
const fa = { id: "f1", estado: "anulada", tipo: "FA", total: 100000, fecha: "2026-10-01", moneda: "ARS" };
const nc = { id: "n1", estado: "emitida", tipo: "NCA", total: 100000, fecha: "2026-10-02", moneda: "ARS", factura_origen_id: "f1" };
const otra = { id: "f2", estado: "emitida", tipo: "FA", total: 50000, fecha: "2026-10-01", moneda: "ARS" };
const ncParcial = { id: "n2", estado: "emitida", tipo: "NCA", total: 10000, fecha: "2026-10-05", moneda: "ARS", factura_origen_id: "f2" };
let gestion = L.filtrarParaGestion([fa, nc, otra, ncParcial]);
assert.deepEqual([...gestion.map((r) => r.id)], ["f2", "n2"]);
// La factura anulada puede no venir en la consulta (otro rango de fechas): se pasa por idsAnulados
gestion = L.filtrarParaGestion([nc, otra], ["f1"]);
assert.deepEqual([...gestion.map((r) => r.id)], ["f2"]);

// B11: totales por mes, NC negativa, monedas separadas, día 1 en su mes
const mensual = L.totalesMensuales([
  { fecha: "2026-10-01", tipo: "FA", total: 1000, moneda: "ARS" },
  { fecha: "2026-10-15", tipo: "NCA", total: 200, moneda: "ARS" },
  { fecha: "2026-10-20", tipo: "FA", total: 50, moneda: "USD" },
  { fecha: "2026-09-30", tipo: "FB", total: 10, moneda: "ARS" },
  { fecha: null, tipo: "FA", total: 999, moneda: "ARS" },
]);
assert.deepEqual(JSON.parse(JSON.stringify(mensual)), { "2026-10": { ARS: 800, USD: 50 }, "2026-09": { ARS: 10, USD: 0 } });

// Equivalente en pesos
assert.equal(L.equivalenteARS(100, "ARS", null), 100);
assert.equal(L.equivalenteARS(100, "USD", 1000), 100000);
assert.equal(L.equivalenteARS(100, "USD", null, 900), 90000);
assert.equal(L.equivalenteARS(100, "USD", null), null);

// B2: Libro IVA — factura + su NC dan cero; monedas separadas; USD convertido solo con cotización
assert.equal(L.incluirEnLibroIVAVentas({ estado: "anulada", cae: "123" }), true);
assert.equal(L.incluirEnLibroIVAVentas({ estado: "anulada", cae: null }), false);
assert.equal(L.incluirEnLibroIVAVentas({ estado: "emitida", cae: null }), true);
assert.equal(L.incluirEnLibroIVACompras({ estado: "anulada" }), false);
assert.equal(L.incluirEnLibroIVACompras({ estado: "recibida" }), true);

const filas = [
  { tipo: "FA", moneda: "ARS", neto_gravado: 100000, iva: 21000, total: 121000 },
  { tipo: "NCA", moneda: "ARS", neto_gravado: 100000, iva: 21000, total: 121000 },
  { tipo: "FA", moneda: "ARS", neto_gravado: 1000, iva: 210, total: 1210 },
  { tipo: "FA", moneda: "USD", neto_gravado: 100, iva: 21, total: 121, tipo_cambio: 1000 },
  { tipo: "FA", moneda: "USD", neto_gravado: 10, iva: 2.1, total: 12.1, tipo_cambio: null },
  { tipo: "NC A", moneda: "ARS", neto_gravado: -50, iva: -10.5, percepciones: 0, total: -60.5 }, // ya negativa: no se da vuelta
].map(L.firmarFilaLibro);
assert.equal(filas[1].iva, -21000);
assert.equal(filas[5].total, -60.5);
assert.ok(!Object.is(filas[1].percepciones, -0), "sin -0");
const t = L.totalesLibroIVA(filas);
assert.deepEqual({ ...t.ARS }, { cantidad: 4, neto_gravado: 950, iva: 199.5, percepciones: 0, total: 1149.5 });
assert.deepEqual({ ...t.USD }, { cantidad: 2, neto_gravado: 110, iva: 23.1, percepciones: 0, total: 133.1 });
assert.deepEqual({ ...t.USDenARS }, { cantidad: 1, neto_gravado: 100000, iva: 21000, percepciones: 0, total: 121000 });
assert.equal(t.usdSinCotizacion, 1);

console.log("test-reportes-comprobantes: OK");
