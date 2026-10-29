// @ts-nocheck — prueba escrita en JS (venía de .mjs); se chequea corriéndola, no con tsc
// Prueba de src/lib/revisar-finanzas.ts — correr con: npx tsx scripts/test-revisar-finanzas.ts
import assert from "node:assert/strict";
import { hallazgosAutomaticos, ordenarRevisar, estaPospuesto, destinoEntidad, motivoLabel } from "../src/lib/revisar-finanzas";

const hoy = "2026-10-12";

// Fechas futuras: solo las posteriores a hoy y no anuladas.
const h = hallazgosAutomaticos({
  hoy,
  movimientos: [
    { id: "m1", fecha: "2026-11-20", monto: 3677887.22, tipo: "cheque_recibido", descripcion: "Cobro — DEL SOL" },
    { id: "m2", fecha: "2026-10-12", monto: 100, tipo: "cobro" },
    { id: "m3", fecha: "2026-10-16", monto: 10110492.35, tipo: "cheque_recibido", anulado: true },
  ],
  cheques: [
    { id: "c1", numero: "3644", monto: 1, fecha_pago: "2026-10-08", estado: "en_cartera", direccion: "recibido", origen_nombre: "DEL SOL" },
    { id: "c2", numero: "2", monto: 1, fecha_pago: "2026-10-10", estado: "en_cartera", direccion: "recibido" }, // 2 días: todavía no
    { id: "c3", numero: "3", monto: 1, fecha_pago: "2026-09-01", estado: "depositado", direccion: "recibido" },
    { id: "c4", numero: "4", monto: 1, fecha_pago: "2026-09-01", estado: "en_cartera", direccion: "emitido" },
  ],
  extractoPendientes: 125,
});
assert.deepEqual(h.map((x) => x.clave), ["fut-m1", "chq-c1", "extracto"]);
assert.equal(h[0].titulo, "Cobro con cheque con fecha 20/11/2026");
assert.equal(h[1].titulo, "Cheque 3644 de DEL SOL en cartera");
assert.equal(h[2].titulo, "125 líneas del extracto sin cruzar");
assert.equal(hallazgosAutomaticos({ hoy, movimientos: [], cheques: [], extractoPendientes: 0 }).length, 0);

// Orden: primero los que ya tocan recordar, después pendientes, al final resueltos.
const items = [
  { id: "a", estado: "resuelto", recordar_el: null, created_at: "2026-10-12T10:00:00Z" },
  { id: "b", estado: "pendiente", recordar_el: null, created_at: "2026-10-11T10:00:00Z" },
  { id: "c", estado: "pendiente", recordar_el: "2026-10-12", created_at: "2026-10-01T10:00:00Z" },
  { id: "d", estado: "pendiente", recordar_el: "2026-10-20", created_at: "2026-10-12T09:00:00Z" },
];
assert.deepEqual(ordenarRevisar(items, hoy).map((i) => i.id), ["c", "d", "b", "a"]);
assert.equal(estaPospuesto(items[3], hoy), true);
assert.equal(estaPospuesto(items[2], hoy), false);

assert.deepEqual(destinoEntidad("factura_venta", "f1"), { href: "/facturas?factura=f1" });
assert.deepEqual(destinoEntidad("cheque", "x"), { tab: "echeqs" });
assert.equal(destinoEntidad("otro", null), null);
assert.equal(motivoLabel("diferencia_cobro"), "Diferencia en un cobro");
assert.equal(motivoLabel("algo libre"), "algo libre");

console.log("revisar-finanzas OK");
