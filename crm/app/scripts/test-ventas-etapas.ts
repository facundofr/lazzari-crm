import assert from "node:assert/strict";
import { etapaVenta, enBandeja, resumenBandeja, type VentaEtapaInput } from "../src/lib/ventas-etapas";

const hoy = "2026-10-12";
const base: VentaEtapaInput = { fechaPr: "2026-10-01", totalPr: 1000, monedaPr: "ARS", ocCliente: null, clientePideOc: false, facturas: [], remitos: [] };
const fa = (o: Partial<VentaEtapaInput["facturas"][0]> = {}) => ({ id: "f1", tipo: "FA", estado: "emitida", fecha: "2026-10-05", total: 1000, total_acreditado: 0, moneda: "ARS", fecha_vencimiento: "2026-11-04", ...o });

// Aprobado sin nada: falta facturar y entregar.
let e = etapaVenta(base, {}, hoy);
assert.deepEqual(e.pendientes, ["facturar", "entregar"]);
assert.equal(e.proximoPaso, "facturar");
assert.equal(e.dias, 11);
assert.ok(enBandeja(e, "facturar") && enBandeja(e, "entregar") && !enBandeja(e, "cobrar"));

// Cliente que pide OC y no la tiene: esperando OC (no en "facturar").
e = etapaVenta({ ...base, clientePideOc: true }, {}, hoy);
assert.equal(e.esperandoOc, true);
assert.equal(e.proximoPaso, "oc");
assert.ok(enBandeja(e, "esperando_oc") && !enBandeja(e, "facturar"));
e = etapaVenta({ ...base, clientePideOc: true, ocCliente: "4500" }, {}, hoy);
assert.equal(e.esperandoOc, false);

// Facturada, sin cobrar, entregada.
e = etapaVenta({ ...base, facturas: [fa()], remitos: [{ estado: "entregado" }] }, {}, hoy);
assert.deepEqual(e.pendientes, ["cobrar"]);
assert.equal(e.saldo, 1000);
assert.equal(e.dias, 7);
assert.equal(e.importe, 1000);

// Cobro parcial y NC parcial.
e = etapaVenta({ ...base, facturas: [fa({ total_acreditado: 100 })], remitos: [{ estado: "entregado" }] }, { f1: 400 }, hoy);
assert.equal(e.saldo, 500);
assert.equal(e.cobradoParcial, true);
assert.equal(e.cobrado, false);

// Cobrada del todo por saldo aunque el estado diga "emitida".
e = etapaVenta({ ...base, facturas: [fa()], remitos: [{ estado: "entregado" }] }, { f1: 1000 }, hoy);
assert.equal(e.cobrado, true);
assert.equal(e.terminada, true);
assert.ok(enBandeja(e, "terminadas"));

// Pagada sin datos de cobros: cuenta como cobrada.
e = etapaVenta({ ...base, facturas: [fa({ estado: "pagada" })], remitos: [] }, null, hoy);
assert.equal(e.cobrado, true);
assert.deepEqual(e.pendientes, ["entregar"]);

// Factura anulada por NC (la NC queda "emitida"): hay que volver a facturar. La NC no es la factura vigente.
e = etapaVenta({ ...base, facturas: [fa({ estado: "anulada" }), { id: "nc1", tipo: "NCEA", estado: "emitida", fecha: "2026-10-06", total: 1000, moneda: "ARS" }] }, {}, hoy);
assert.equal(e.facturada, false);
assert.equal(e.refacturar, true);
assert.equal(e.facturaVigenteId, null);
assert.ok(enBandeja(e, "facturar"));

// Vencida.
e = etapaVenta({ ...base, facturas: [fa({ fecha_vencimiento: "2026-10-10" })] }, {}, hoy);
assert.equal(e.vencida, true);

// En entrega (remito pendiente).
e = etapaVenta({ ...base, remitos: [{ estado: "pendiente" }] }, {}, hoy);
assert.equal(e.enEntrega, true);
assert.equal(e.entregado, false);

// Resumen por moneda.
const etapas = [
  etapaVenta(base, {}, hoy),
  etapaVenta({ ...base, totalPr: 50, monedaPr: "USD" }, {}, hoy),
  etapaVenta({ ...base, facturas: [fa()] }, { f1: 300 }, hoy),
];
assert.deepEqual(resumenBandeja(etapas, "facturar"), { cantidad: 2, ARS: 1000, USD: 50 });
assert.deepEqual(resumenBandeja(etapas, "cobrar"), { cantidad: 1, ARS: 700, USD: 0 });
assert.equal(resumenBandeja(etapas, "todas").cantidad, 3);

console.log("test-ventas-etapas OK");
