// "Cargar factura" simple: renglones, reparto del envío por plata y faltantes por OC.
// Uso (desde crm/app): npx tsx scripts/test-cargar-factura.ts
import assert from "node:assert/strict";
import { matchPurchaseLines, heuristicEquivalences } from "../src/lib/purchase-matching";
import { armarRenglones, repartirEnvio, importePorOc, faltantesPorOc } from "../src/lib/cargar-factura";

const ocs = [
  { id: "l1", ocId: "A", ocNumero: "OC-2026-1247", ocFecha: "2026-10-15", codigo: "P1", descripcion: "BOTIN PRUSIANO PVC NEGRO", cantidad: 20, precio: 100 },
  { id: "l2", ocId: "B", ocNumero: "OC-2026-1252", ocFecha: "2026-10-15", codigo: "G1", descripcion: "GUANTE NITRILO", cantidad: 5, precio: 50 },
];
const info = new Map(ocs.map(o => [o.id, { ocId: o.ocId, ocNumero: o.ocNumero, moneda: "ARS", descripcion: o.descripcion }]));
const fc = [
  { key: "a", codigo: "P1", descripcion: "BOTIN PRUSIANO PVC NEGRO", cantidad: 18, precio: 110 },   // 18 de 20, precio mayor
  { key: "b", codigo: "G1", descripcion: "GUANTE NITRILO", cantidad: 5, precio: 45 },               // precio menor
  { key: "c", codigo: null, descripcion: "CASCO LIBUS BLANCO", cantidad: 2, precio: 900 },          // no está
  { key: "d", codigo: null, descripcion: "ENVIO ANDREANI", cantidad: 1, precio: 3000 },             // envío
];
const r = matchPurchaseLines(fc, ocs, heuristicEquivalences(fc, ocs));
const ren = armarRenglones({ lineas: fc, resultado: r, ocLinea: info, monedaFactura: "ARS" });
const por = Object.fromEntries(ren.map(x => [x.key, x]));
assert.equal(por.a.tipo, "ok"); assert.equal(por.a.compara, "mayor"); assert.equal(por.a.pct, 10);
assert.equal(por.b.compara, "menor");
assert.equal(por.c.tipo, "no_esta"); assert.equal(por.c.sinOc, 2);
assert.equal(por.d.tipo, "envio");

// Envío repartido por plata: A = 18×110 = 1980, B = 5×45 = 225 → 3000 × 1980/2205 y el resto.
const imp = importePorOc(ren);
assert.deepEqual(imp.map(i => i.ocId), ["A", "B"]);
const rep = repartirEnvio(3000, imp);
assert.equal(rep[0].monto, 2693.88);
assert.equal(rep[1].monto, 306.12);
assert.equal(rep.reduce((t, x) => t + x.monto, 0), 3000);
assert.deepEqual(repartirEnvio(3000, [{ ocId: "A", ocNumero: "OC-1", importe: 0 }, { ocId: "B", ocNumero: "OC-2", importe: 0 }]).map(x => x.monto), [1500, 1500]);
assert.deepEqual(repartirEnvio(3000, []), []);

// Faltantes: la OC-1247 queda con 2 sin llegar; la 1252 completa.
assert.deepEqual(faltantesPorOc(r, new Set(["A", "B"])), [{ ocId: "A", ocNumero: "OC-2026-1247", vienen: 18, total: 20, faltan: 2 }]);
assert.deepEqual(faltantesPorOc(r, new Set(["B"])), [], "solo pregunta por las OC tildadas");

// "No es": un renglón rechazado pasa a "no está".
const ren2 = armarRenglones({ lineas: fc, resultado: r, ocLinea: info, monedaFactura: "ARS", rechazadas: new Set(["a"]) });
assert.equal(ren2[0].tipo, "no_esta");
// Factura en dólares contra OC en pesos: no se compara el precio.
const ren3 = armarRenglones({ lineas: fc, resultado: r, ocLinea: info, monedaFactura: "USD" });
assert.equal(ren3[0].compara, "otra_moneda");

console.log("OK: cargar factura (precio mayor/menor, no está, envío repartido por plata, faltantes 18 de 20, rechazada, otra moneda).");
