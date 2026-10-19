// Prueba rápida de lib/transportes-anotador (sin base). Uso (desde crm/app): npx tsx scripts/test-transportes-anotador.ts
import assert from "node:assert/strict";
import { claveViaje, precioViaje, ultimoPrecio, conteoDelDia, viajeParaQuitar, resumenMes, grillaMes, filtrarHistorial, diasDelMes, sumarDias, esPropio, type ViajeAnotador, type TransportistaAnotador } from "../src/lib/transportes-anotador";

const cat: TransportistaAnotador[] = [
  { id: "alv", nombre: "JOSE ALVAREZ", activo: true, precio_viaje_fijo: 3000 },
  { id: "con", nombre: "CONTE", activo: true, precio_viaje_fijo: null },
];
let n = 0;
const v = (p: Partial<ViajeAnotador>): ViajeAnotador => ({
  id: `v${++n}`, fecha: "2026-10-01", tipo: "externo", transportista: "CONTE", transportista_id: "con", remito_id: null, cliente_id: null,
  destino: "", notas: null, descripcion_carga: null, bultos: null, costo: null, moneda: "ARS", estado: "entregado", factura_compra_id: null,
  created_at: `2026-10-01T10:00:${String(n).padStart(2, "0")}`, ...p,
});

// Álvarez viejo: interno, sin id, por nombre (mayúsculas/minúsculas) → su id del catálogo.
assert.equal(claveViaje({ transportista: "Jose Alvarez", transportista_id: null }, cat), "alv");
assert.equal(claveViaje({ transportista: "Otro", transportista_id: null }, cat), "n:otro");
assert.ok(esPropio({ tipo: "interno", transportista: "Propio (lo llevamos nosotros)" }));
assert.ok(!esPropio({ tipo: "interno", transportista: "JOSE ALVAREZ" }));

// Precio: el del viaje; si no tiene, el fijo; sin fijo = null.
assert.equal(precioViaje({ costo: 5000 }, 3000), 5000);
assert.equal(precioViaje({ costo: null }, 3000), 3000);
assert.equal(precioViaje({ costo: null }, null), null);
assert.equal(precioViaje({ costo: 0 }, 3000), 0);

const viajes: ViajeAnotador[] = [
  v({ transportista: "JOSE ALVAREZ", transportista_id: null, tipo: "interno" }),
  v({ transportista: "JOSE ALVAREZ", transportista_id: null, tipo: "interno", costo: 3500 }),
  v({ remito_id: "r1", estado: "solicitado", costo: 20000 }),          // Conte de remito
  v({ costo: 18000, fecha: "2026-09-30" }),                             // Conte, otro mes
  v({ estado: "cancelado" }),                                           // no cuenta
  v({ tipo: "interno", transportista: "Propio (lo llevamos nosotros)", transportista_id: null, remito_id: "r2" }), // no cuenta
  v({ factura_compra_id: "fc1", costo: 25000 }),                        // Conte anotado y liquidado
];

const dia = conteoDelDia(viajes, "2026-10-01", cat);
assert.deepEqual(dia.get("alv"), { anotados: 2, remito: 0 });
assert.deepEqual(dia.get("con"), { anotados: 1, remito: 1 });
assert.equal(dia.size, 2);

assert.equal(ultimoPrecio(viajes, "con", cat), 25000); // el último cargado (mismo día, creado después)
assert.equal(ultimoPrecio(viajes, "alv", cat), 3500);

// "−": el último anotado libre; nunca el de remito ni el liquidado.
assert.equal(viajeParaQuitar(viajes, "2026-10-01", "alv", cat).id, "v2");
const quitarConte = viajeParaQuitar(viajes, "2026-10-01", "con", cat);
assert.equal(quitarConte.id, null);
assert.match(quitarConte.motivo || "", /liquid/);
assert.equal(viajeParaQuitar([v({ notas: "llevó cajas" })], "2026-10-01", "con", cat).id, null);
assert.equal(viajeParaQuitar([v({ remito_id: "r9" })], "2026-10-01", "con", cat).id, null);

// Resumen de octubre: Álvarez 2 viajes = 3000 (fijo) + 3500; Conte 2 (remito + liquidado), 1 pendiente.
const res = resumenMes(viajes, "2026-10", cat);
const alv = res.find((r) => r.clave === "alv")!;
assert.equal(alv.viajes, 2); assert.equal(alv.total, 6500); assert.equal(alv.sinPrecio, 0); assert.equal(alv.pendientes.length, 2);
const con = res.find((r) => r.clave === "con")!;
assert.equal(con.viajes, 2); assert.equal(con.deRemito, 1); assert.equal(con.liquidados, 1);
assert.equal(con.total, 45000); assert.equal(con.totalPendiente, 20000); assert.equal(con.pendientes.length, 1);
assert.equal(res.length, 2);
// Sin precio ni fijo cuenta como "sin precio".
assert.equal(resumenMes([v({})], "2026-10", cat)[0].sinPrecio, 1);

// Grilla.
const g = grillaMes(viajes, "2026-10", cat);
assert.equal(g.get("alv")!.get(1), 2);
assert.equal(g.get("con")!.get(1), 2);
assert.equal(diasDelMes("2026-02"), 28);
assert.equal(diasDelMes("2026-10"), 31);

// Filtros.
assert.equal(filtrarHistorial(viajes, {}, cat).length, 6);
assert.equal(filtrarHistorial(viajes, { verCancelados: true }, cat).length, 7);
assert.equal(filtrarHistorial(viajes, { origen: "remito" }, cat).length, 2);
assert.equal(filtrarHistorial(viajes, { clave: "con", desde: "2026-10-01" }, cat).length, 2);
assert.equal(filtrarHistorial(viajes, { liquidado: "si" }, cat).length, 1);
assert.equal(filtrarHistorial(viajes, { texto: "alvarez" }, cat).length, 2);
assert.equal(filtrarHistorial(viajes, { texto: "R-0018" }, cat, (x) => (x.remito_id === "r1" ? "R-0018-83" : "")).length, 1);

assert.equal(sumarDias("2026-10-01", -1), "2026-09-30");
assert.equal(sumarDias("2026-12-31", 1), "2027-01-01");

console.log("OK transportes-anotador");
