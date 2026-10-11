// Prueba rápida: npx tsx scripts/test-estado-factura-venta.mjs
import assert from "node:assert/strict";
import { estadoVisibleFactura as e } from "../src/lib/estado-factura-venta.ts";

const hoy = "2026-10-11";
assert.equal(e({ estado: "emitida" }, "2026-10-20", hoy), "pendiente");
assert.equal(e({ estado: "emitida" }, "2026-10-07", hoy), "vencida");
assert.equal(e({ estado: "emitida" }, null, hoy), "pendiente");
assert.equal(e({ estado: "emitida", cheque_rechazado_at: "2026-10-11T15:00:00Z" }, "2026-10-07", hoy), "cheque_rechazado");
assert.equal(e({ estado: "parcial", cheque_rechazado_at: "2026-10-11T15:00:00Z" }, null, hoy), "cheque_rechazado");
// Si después se cobró, manda "pagada".
assert.equal(e({ estado: "pagada", cheque_rechazado_at: "2026-10-11T15:00:00Z" }, null, hoy), "pagada");
assert.equal(e({ estado: "anulada", cheque_rechazado_at: "2026-10-11T15:00:00Z" }, null, hoy), "anulada");
assert.equal(e({ estado: "parcial" }, null, hoy), "parcial");
console.log("estado-factura-venta OK");
