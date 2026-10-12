// Prueba rápida: npx tsx scripts/test-tc-cobro-usd.mjs
import assert from "node:assert/strict";
import { modalidadCobroUsd, compararTcCobro, mensajeActualizacionTc } from "../src/lib/tc-cobro-usd.ts";

// Divisa o billete: manda la factura; si no dice, la ficha del cliente.
assert.equal(modalidadCobroUsd(["billetes"], "USD Divisa"), "billetes");
assert.equal(modalidadCobroUsd([null, undefined], "USD"), "billetes");
assert.equal(modalidadCobroUsd([null], "USD Divisa"), "divisas");
assert.equal(modalidadCobroUsd([], "ARS"), "divisas");
assert.equal(modalidadCobroUsd(["divisas", "billetes"], "USD"), "billetes");
assert.equal(modalidadCobroUsd(["divisas", "billetes"], null), "divisas");

// 3,1 % abajo del BNA → aviso, con lo que falta en pesos.
const abajo = compararTcCobro(1492.26, 1540, 1000);
assert.equal(abajo.estado, "abajo");
assert.equal(abajo.faltante, 47740);
assert.ok(Math.abs(abajo.diferenciaPct + 0.031) < 0.001);

// 1,5 % abajo → dentro del 2 %, sin aviso.
assert.equal(compararTcCobro(1516.9, 1540, 1000).estado, "en_rango");
// Justo 2 % abajo → sin aviso (tiene que pasarlo).
assert.equal(compararTcCobro(1509.2, 1540, 1000).estado, "en_rango");
// Igual al BNA → en rango.
assert.equal(compararTcCobro(1540, 1540, 1000).estado, "en_rango");
// Pagó arriba → verde.
const arriba = compararTcCobro(1560, 1540, 1000);
assert.equal(arriba.estado, "arriba");
assert.equal(arriba.faltante, -20000);
// Sin datos → nada.
assert.equal(compararTcCobro(0, 1540, 1000), null);
assert.equal(compararTcCobro(1500, 0, 1000), null);
assert.equal(compararTcCobro(1500, 1540, 0), null);

const msj = mensajeActualizacionTc({ facturas: ["A 0015-00000030"], tcCliente: 1492.26, tcBna: 1540, modalidad: "billetes", fechaBna: "2026-10-09", faltante: 47740 });
assert.match(msj, /la factura A 0015-00000030/);
assert.match(msj, /billete del 09\/10\/2026/);
assert.match(msj, /\$47\.740,00/);

console.log("OK: tipo de cambio de cobros USD (modalidad, aviso 2 %, mensaje).");
