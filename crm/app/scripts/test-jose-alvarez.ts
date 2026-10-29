// Prueba de lib/jose-alvarez.ts — npx tsx scripts/test-jose-alvarez.ts
import assert from "node:assert/strict";
import { comisionDelMes, detalleComision, detalleInteres, mesTexto, JOSE_ALVAREZ } from "../src/lib/jose-alvarez";

assert.equal(mesTexto("2026-09"), "septiembre 2026");
// Los mismos textos con que se cargó el pago del 06/10 (así la tarjeta lo reconoce como ya cargado)
assert.equal(detalleComision("2026-09"), "Comisión septiembre 2026 — José Alvarez");
assert.equal(detalleInteres("2026-10"), "Interés préstamo José Alvarez — octubre 2026");
assert.equal(JOSE_ALVAREZ.interes, 150000);

// Septiembre real: FA 15-15 y FA 15-28 (margen $ 336.720,82 → comisión $ 303.048,74)
const filas = [
  { presupuestoId: "pr1122", venta: { neto: 419448 }, costo: { neto: 279632 } },
  { presupuestoId: "pr1129", venta: { neto: 549504.82 }, costo: { neto: 352600 } },
  { presupuestoId: "otro", venta: { neto: 1000000 }, costo: { neto: 1 } }, // de otro vendedor: no cuenta
  { presupuestoId: null, venta: { neto: 5000 }, costo: { neto: 0 } },     // sin PR: no cuenta
];
const sep = comisionDelMes(filas, new Set(["pr1122", "pr1129"]));
assert.equal(sep.facturas, 2);
assert.equal(sep.margen, 336720.82);
assert.equal(sep.comision, 303048.74);

// Una NC de una factura suya resta (venta y costo negativos)
const conNc = comisionDelMes([...filas, { presupuestoId: "pr1122", venta: { neto: -100000 }, costo: { neto: -60000 } }], new Set(["pr1122", "pr1129"]));
assert.equal(conNc.margen, 296720.82);
assert.equal(conNc.comision, 267048.74);

// Margen negativo o sin ventas: comisión 0 (nunca negativa)
assert.equal(comisionDelMes([{ presupuestoId: "p", venta: { neto: 100 }, costo: { neto: 200 } }], new Set(["p"])).comision, 0);
assert.equal(comisionDelMes([], new Set(["p"])).comision, 0);
console.log("test-jose-alvarez OK");
