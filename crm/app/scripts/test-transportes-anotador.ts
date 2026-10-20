// Prueba rápida de lib/transportes-anotador (sin base). Uso (desde crm/app): npx tsx scripts/test-transportes-anotador.ts
import assert from "node:assert/strict";
import {
  claveViaje, montoViaje, montoInicial, viajesDelMes, sinLiquidar, viajeParaQuitar, fechaParaSumar, resumenMes, totalMontos,
  diasDelMes, sumarMeses, leerMonto, esPropio, cuentaEnTransportes, type ViajeAnotador, type TransportistaAnotador,
} from "../src/lib/transportes-anotador";

const cat: TransportistaAnotador[] = [
  { id: "alv", nombre: "JOSE ALVAREZ", activo: true, precio_viaje_fijo: 3000 },
  { id: "con", nombre: "CONTE", activo: true, precio_viaje_fijo: null },
];
let n = 0;
const v = (p: Partial<ViajeAnotador>): ViajeAnotador => ({
  id: `v${++n}`, fecha: "2026-10-01", tipo: "externo", transportista: "CONTE", transportista_id: "con", remito_id: null,
  costo: null, moneda: "ARS", estado: "entregado", factura_compra_id: null,
  created_at: `2026-10-01T10:00:${String(n).padStart(2, "0")}`, ...p,
});

// Álvarez viejo: interno, sin id, por nombre (mayúsculas/minúsculas) → su id del catálogo.
assert.equal(claveViaje({ transportista: "Jose Alvarez", transportista_id: null }, cat), "alv");
assert.equal(claveViaje({ transportista: "Otro", transportista_id: null }, cat), "n:otro");
assert.ok(esPropio({ tipo: "interno", transportista: "Propio (lo llevamos nosotros)" }));
assert.ok(!esPropio({ tipo: "interno", transportista: "JOSE ALVAREZ" }));
assert.ok(!cuentaEnTransportes({ remito_id: "r1", tipo: "externo", transportista: "CONTE" }));

// Monto: solo el del viaje (nada se completa solo). El + arranca con el fijo solo si lo tiene.
assert.equal(montoViaje({ costo: 5000 }), 5000);
assert.equal(montoViaje({ costo: null }), null);
assert.equal(montoInicial(cat[0]), 3000);
assert.equal(montoInicial(cat[1]), null);
assert.equal(montoInicial({ precio_viaje_fijo: 0 }), null);

const viajes: ViajeAnotador[] = [
  v({ transportista: "JOSE ALVAREZ", transportista_id: null, tipo: "interno" }),                    // Álvarez sin monto
  v({ transportista: "JOSE ALVAREZ", transportista_id: null, tipo: "interno", costo: 3500 }),
  v({ remito_id: "r1", estado: "solicitado", costo: 20000 }),                                      // Conte de remito: no cuenta
  v({ costo: 18000, fecha: "2026-09-30" }),                                                        // Conte, otro mes
  v({ estado: "cancelado", fecha: "2026-10-02" }),                                                 // no cuenta
  v({ tipo: "interno", transportista: "Propio (lo llevamos nosotros)", transportista_id: null }),  // no cuenta
  v({ factura_compra_id: "fc1", costo: 25000, fecha: "2026-10-05" }),                              // Conte liquidado
  v({ costo: 10000, fecha: "2026-10-03" }),                                                        // Conte libre
];

const res = resumenMes(viajes, "2026-10", cat);
const alv = res.find((r) => r.clave === "alv")!;
assert.equal(alv.viajes, 2);
assert.equal(alv.sinMonto, 1);
assert.equal(alv.total, 3500);
const con = res.find((r) => r.clave === "con")!;
assert.equal(con.viajes, 2);              // sin el de remito, el cancelado ni el propio
assert.equal(con.liquidados, 1);
assert.equal(con.total, 35000);
assert.equal(con.pendientes.length, 1);
assert.equal(con.totalPendiente, 10000);
assert.equal(res.some((r) => r.clave.startsWith("n:propio")), false);

// Viajes del mes (por fecha), con y sin cancelados.
assert.deepEqual(viajesDelMes(viajes, "2026-10", "con", cat).map((x) => x.fecha), ["2026-10-03", "2026-10-05"]);
assert.equal(viajesDelMes(viajes, "2026-10", "con", cat, true).length, 3);
assert.equal(sinLiquidar(viajesDelMes(viajes, "2026-10", "con", cat)).length, 1);

// "−": el último del mes sin liquidar (salta el liquidado del 5/10).
assert.equal(viajeParaQuitar(viajes, "2026-10", "con", cat)?.fecha, "2026-10-03");
assert.equal(viajeParaQuitar(viajes, "2026-09", "alv", cat), null);

// "+": hoy en el mes actual; en otro mes, el último día.
assert.equal(fechaParaSumar("2026-10", "2026-10-19"), "2026-10-19");
assert.equal(fechaParaSumar("2026-09", "2026-10-19"), "2026-09-30");
assert.equal(fechaParaSumar("2024-02", "2026-10-19"), "2024-02-29");

assert.equal(totalMontos(viajes.slice(0, 2)), 3500);
assert.equal(diasDelMes("2026-02"), 28);
assert.equal(sumarMeses("2026-01", -1), "2025-12");
assert.equal(sumarMeses("2026-12", 1), "2027-01");
assert.equal(leerMonto("3.000"), 3000);
assert.equal(leerMonto("$ 2500,50"), 2500.5);
assert.equal(leerMonto(""), null);
assert.equal(leerMonto("abc"), undefined);
assert.equal(leerMonto("-5"), undefined);

console.log("OK transportes-anotador");
