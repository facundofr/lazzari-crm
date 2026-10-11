// Prueba rápida: npx tsx scripts/test-fecha-cobro.mjs
import assert from "node:assert/strict";
import { fechaMedioCobro, fechaCobroSugerida, avisoFechaCobroFutura } from "../src/lib/fecha-cobro.ts";

const hoy = "2026-09-30";

// eCheq con fecha de pago futura: el cobro va hoy (caso DEL SOL).
assert.equal(fechaMedioCobro({ tipo: "echeq", fecha: "2026-11-20", fecha_cobro: "2026-11-20" }, hoy), hoy);
assert.equal(fechaMedioCobro({ tipo: "cheque_recibido", fecha: "2026-10-16" }, hoy), hoy);
// Transferencia: fecha de acreditación.
assert.equal(fechaMedioCobro({ tipo: "transferencia", fecha: "2026-09-28", fecha_cobro: "2026-09-29" }, hoy), "2026-09-29");
// Transferencia con fecha futura (mal leída): hoy.
assert.equal(fechaMedioCobro({ tipo: "transferencia", fecha: "2026-12-01" }, hoy), hoy);
// Sin fecha: hoy.
assert.equal(fechaMedioCobro({ tipo: "deposito" }, hoy), hoy);

// Cobro entero: ignora cheques y retenciones.
assert.equal(fechaCobroSugerida([
  { tipo: "echeq", fecha: "2026-11-20" },
  { tipo: "retencion_ganancias", fecha: "2026-11-20" },
], hoy), hoy);
assert.equal(fechaCobroSugerida([
  { tipo: "echeq", fecha: "2026-11-20" },
  { tipo: "transferencia", fecha: "2026-09-25" },
], hoy), "2026-09-25");

assert.equal(avisoFechaCobroFutura("2026-09-30", hoy), null);
assert.ok(avisoFechaCobroFutura("2026-11-20", hoy)?.includes("20/11/2026"));

console.log("fecha-cobro OK");
