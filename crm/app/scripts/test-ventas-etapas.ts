import assert from "node:assert/strict";
import { detalleDePr, entregadoSinFacturar, etapaVenta, enBandeja, fechaParaFacturar, resumenBandeja, vaAFacturar, type VentaEtapaInput } from "../src/lib/ventas-etapas";

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

// Con remito ya cuenta como entregado, aunque el remito diga "pendiente" (el remito se hace para entregar).
e = etapaVenta({ ...base, remitos: [{ estado: "pendiente" }] }, {}, hoy);
assert.equal(e.enEntrega, false);
assert.equal(e.entregado, true);

// Remito anulado: no cuenta como entregado.
e = etapaVenta({ ...base, remitos: [{ estado: "entregado", anulado: true }] }, {}, hoy);
assert.equal(e.entregado, false);

// Finanzas → Facturar (P03): aprobado como siempre; PR vencido con remito y sin factura también ("entregado sin facturar").
const conRemito = etapaVenta({ ...base, remitos: [{ estado: "entregado", anulado: false }] }, {}, hoy);
assert.equal(vaAFacturar({ estado: "aprobado" }, etapaVenta(base, {}, hoy)), true);
assert.equal(entregadoSinFacturar({ estado: "aprobado" }, conRemito), false);
assert.equal(vaAFacturar({ estado: "vencido" }, conRemito), true);
assert.equal(entregadoSinFacturar({ estado: "vencido" }, conRemito), true);
// Eliminado con remito: no (se reemplazó por otro PR y se facturó desde ese, ej. PR-2026-1030 de Bomberos).
assert.equal(vaAFacturar({ estado: "vencido", eliminado: true }, conRemito), false);
// Sin remito, o con el remito anulado, el vencido no aparece.
assert.equal(vaAFacturar({ estado: "vencido" }, etapaVenta(base, {}, hoy)), false);
assert.equal(vaAFacturar({ estado: "vencido" }, etapaVenta({ ...base, remitos: [{ estado: "entregado", anulado: true }] }, {}, hoy)), false);
// Con factura vigente no aparece; con la factura anulada por NC, sí (volver a facturar).
assert.equal(vaAFacturar({ estado: "vencido" }, etapaVenta({ ...base, facturas: [fa()], remitos: [{ estado: "entregado" }] }, {}, hoy)), false);
assert.equal(vaAFacturar({ estado: "vencido" }, etapaVenta({ ...base, facturas: [fa({ estado: "anulada" })], remitos: [{ estado: "entregado" }] }, {}, hoy)), true);
// «rechazado» (lo que deja "No facturar") y el aprobado eliminado sin remito no aparecen.
assert.equal(vaAFacturar({ estado: "rechazado" }, conRemito), false);
assert.equal(vaAFacturar({ estado: "aprobado", eliminado: true }, etapaVenta(base, {}, hoy)), false);

// Resumen por moneda.
const etapas = [
  etapaVenta(base, {}, hoy),
  etapaVenta({ ...base, totalPr: 50, monedaPr: "USD" }, {}, hoy),
  etapaVenta({ ...base, facturas: [fa()] }, { f1: 300 }, hoy),
];
assert.deepEqual(resumenBandeja(etapas, "facturar"), { cantidad: 2, ARS: 1000, USD: 50 });
assert.deepEqual(resumenBandeja(etapas, "cobrar"), { cantidad: 1, ARS: 700, USD: 0 });
assert.equal(resumenBandeja(etapas, "todas").cantidad, 3);

// Fecha P/Fact: con OC, la fecha de la OC; sin OC, el día de aprobación (en Argentina); sin nada, la del PR.
assert.equal(fechaParaFacturar({ fecha: "2026-10-01", oc_cliente: "4500", oc_cliente_fecha: "2026-10-05", respondido_at: "2026-10-03T15:00:00Z" }), "2026-10-05");
assert.equal(fechaParaFacturar({ fecha: "2026-10-01", oc_cliente: null, oc_cliente_fecha: null, respondido_at: "2026-10-04T01:30:00+00:00" }), "2026-10-03");
assert.equal(fechaParaFacturar({ fecha: "2026-10-01", oc_cliente: "4500", oc_cliente_fecha: null, respondido_at: null }), "2026-10-01");

// Detalle como en Presupuestos.
assert.deepEqual(detalleDePr([{ descripcion: "Botín" }, { descripcion: "Guante" }, { descripcion: "Casco" }]), { texto: "Botín, Guante...", completo: "Botín, Guante, Casco" });
assert.equal(detalleDePr([], "Pedido por mail").texto, "Pedido por mail");

console.log("test-ventas-etapas OK");
