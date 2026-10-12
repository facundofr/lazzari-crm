// Prueba rápida de src/lib/oc-diferencia.ts. Uso: npx tsx scripts/test-oc-diferencia.mjs
import assert from "node:assert/strict";
import { analizarDiferenciaOC } from "../src/lib/oc-diferencia.ts";

const base = { oc_neto: 100, oc_total: 121, saldo_cerrado: false, cant_pedida: 10, cant_recibida: 10, cant_facturada: null,
  n_facturas: 1, fc_neto: 100, fc_total: 121, todas_pagadas: true, compartida: false, otra_moneda: false, ajuste_activo: false };

assert.equal(analizarDiferenciaOC(null), null);
assert.equal(analizarDiferenciaOC(base), null); // sin diferencia
assert.equal(analizarDiferenciaOC({ ...base, fc_total: 120 }), null); // menos del 1 %
assert.equal(analizarDiferenciaOC({ ...base, n_facturas: 0, fc_total: 0 }), null);
assert.equal(analizarDiferenciaOC({ ...base, fc_total: 60, saldo_cerrado: true }), null);
assert.equal(analizarDiferenciaOC({ ...base, fc_total: 60, ajuste_activo: true }), null);

const precio = analizarDiferenciaOC({ ...base, fc_neto: 65, fc_total: 78.65 }); // descuento
assert.equal(precio.sugerencia, "ajustar");
assert.equal(precio.diferencia, 42.35);
assert.equal(precio.puedeAjustar, true);

const mayor = analizarDiferenciaOC({ ...base, fc_neto: 110, fc_total: 133.1 });
assert.equal(mayor.sugerencia, "ajustar");
assert.ok(mayor.diferencia < 0);

const faltan = analizarDiferenciaOC({ ...base, cant_facturada: 8, fc_neto: 80, fc_total: 96.8 }); // faltan 2 unidades
assert.equal(faltan.sugerencia, "cerrar");
assert.equal(faltan.faltanUnidades, 2);

const compartida = analizarDiferenciaOC({ ...base, compartida: true, fc_total: 60 });
assert.equal(compartida.sugerencia, "cerrar");
assert.equal(compartida.puedeAjustar, false);
console.log("OK test-oc-diferencia");
