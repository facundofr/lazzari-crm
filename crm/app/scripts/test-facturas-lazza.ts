// npx tsx scripts/test-facturas-lazza.ts
import assert from "node:assert/strict";
import { armarFilasFacturas, estadoFactura, filtrarFacturas, prepararSeleccion, recibosPorFactura, totalesFacturas, type FacturaBase } from "../src/lib/facturas-lazza";

const hoy = "2026-10-19";
const base = (x: Partial<FacturaBase> & { id: string }): FacturaBase => ({
  entidadId: "p1", nombre: "De Pascale", fecha: "2026-10-01", fecha_vencimiento: "2026-10-31", comprobante: `FC ${x.id}`,
  moneda: "ARS", total: 1000, estado: "pendiente", nc: false, saldo: 1000, ...x,
});

// Estados
assert.deepEqual(estadoFactura({ anulada: true, nc: false, total: 100, saldo: 100, dias: -5 }), { estado: "anulada", parcial: false });
assert.deepEqual(estadoFactura({ anulada: false, nc: true, total: 100, saldo: 0, dias: 5 }), { estado: "nc", parcial: false });
assert.deepEqual(estadoFactura({ anulada: false, nc: false, total: 100, saldo: 0, dias: -5 }), { estado: "pagada", parcial: false });
assert.deepEqual(estadoFactura({ anulada: false, nc: false, total: 100, saldo: 40, dias: -1 }), { estado: "vencida", parcial: true });
assert.deepEqual(estadoFactura({ anulada: false, nc: false, total: 100, saldo: 40, dias: 3 }), { estado: "parcial", parcial: true });
assert.deepEqual(estadoFactura({ anulada: false, nc: false, total: 100, saldo: 100, dias: 0 }), { estado: "pendiente", parcial: false });

const filas = armarFilasFacturas({
  lado: "compra", hoy,
  facturas: [
    base({ id: "a", fecha_vencimiento: "2026-10-30" }),
    base({ id: "b", fecha_vencimiento: "2026-09-17", saldo: 400 }), // vencida parcial
    base({ id: "c", saldo: 0, fecha: "2026-09-01" }), // pagada
    base({ id: "d", estado: "anulada", saldo: 1000, fecha: "2026-10-05" }), // anulada: saldo 0
    base({ id: "e", entidadId: "p2", nombre: "Segufer", moneda: "USD", total: 50, saldo: 50, fecha_vencimiento: null, fecha: "2026-10-10" }),
    base({ id: "f", entidadId: "p2", nombre: "Segufer", fecha_vencimiento: "2026-10-20" }),
  ],
  docs: new Map([["b", [{ tipo: "op", id: "op72", numero: "OP-000072" }]]]),
});

// Orden: con saldo por vencimiento, después el resto de la más nueva a la más vieja.
assert.deepEqual(filas.map((f) => f.id), ["b", "e", "f", "a", "d", "c"]);
const b = filas.find((f) => f.id === "b")!;
assert.equal(b.estado, "vencida"); assert.equal(b.parcial, true); assert.equal(b.dias, -32); assert.equal(b.docs[0].numero, "OP-000072");
const e = filas.find((f) => f.id === "e")!;
assert.equal(e.sinVencimiento, true); assert.equal(e.vence, "2026-10-10"); assert.equal(e.moneda, "USD");
assert.equal(filas.find((f) => f.id === "d")!.saldo, 0);

// Filtros
assert.deepEqual(filtrarFacturas(filas, { filtro: "pendientes" }).map((f) => f.id), ["b", "e", "f", "a"]);
assert.deepEqual(filtrarFacturas(filas, { filtro: "vencidas" }).map((f) => f.id), ["b", "e"]);
assert.equal(filtrarFacturas(filas, { filtro: "todas" }).length, 6);
assert.deepEqual(filtrarFacturas(filas, { filtro: "todas", texto: "op-000072" }).map((f) => f.id), ["b"]);
assert.deepEqual(filtrarFacturas(filas, { filtro: "pendientes", texto: "segufer" }).map((f) => f.id), ["e", "f"]);

// Totales: solo lo que tiene saldo
const t = totalesFacturas(filas);
assert.deepEqual(t.saldo, { ARS: 2400, USD: 50 });
assert.deepEqual(t.vencido, { ARS: 400, USD: 50 });

// Selección: un proveedor y una moneda, se sigue con el primero tildado y se avisa
const por = (id: string) => filas.find((f) => f.id === id)!;
const s1 = prepararSeleccion([por("a"), por("b")], "compra")!;
assert.deepEqual(s1.ids, ["a", "b"]); assert.equal(s1.saldo, 1400); assert.equal(s1.avisos.length, 0);
const s2 = prepararSeleccion([por("a"), por("f")], "compra")!;
assert.deepEqual(s2.ids, ["a"]); assert.match(s2.avisos[0], /Una OP es de un solo proveedor/);
const s3 = prepararSeleccion([por("f"), por("e")], "venta")!;
assert.deepEqual(s3.ids, ["f"]); assert.match(s3.avisos[0], /\$ y en US\$/);
assert.equal(prepararSeleccion([por("c"), por("d")], "compra"), null); // sin saldo: nada para pagar

// Recibos por factura (sin anulados)
const m = recibosPorFactura([
  { id: "r1", numero: 1000, anulado: false, facturaIds: ["x", "y"] },
  { id: "r2", numero: 1005, anulado: false, facturaIds: ["x"] },
  { id: "r3", numero: 1006, anulado: true, facturaIds: ["x"] },
]);
assert.deepEqual(m.get("x")!.map((d) => d.numero), ["Recibo 1005", "Recibo 1000"]);
assert.deepEqual(m.get("y")!.map((d) => d.id), ["r1"]);

console.log("test-facturas-lazza OK");
