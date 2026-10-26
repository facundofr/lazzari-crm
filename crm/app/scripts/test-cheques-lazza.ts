import assert from "node:assert/strict";
import { enFecha, estadoCheque, proximaSemana, proximasSemanas, resumenPorEstado, type ChequeFL } from "../src/lib/cheques-lazza";

const ch = (x: Partial<ChequeFL> & { id: string }): ChequeFL => ({ numero: x.id, direccion: "emitido", estado: "entregado", fecha_pago: "2026-10-19", monto: 100, moneda: "ARS", ...x });
const hoy = "2026-10-19"; // lunes

const cheques: ChequeFL[] = [
  ch({ id: "a", fecha_pago: "2026-10-17" }),                          // propio en fecha (vencido sin debitar)
  ch({ id: "b", fecha_pago: "2026-10-19", estado: "pendiente" }),     // propio en fecha hoy
  ch({ id: "c", fecha_pago: "2026-10-22" }),                          // semana 1
  ch({ id: "d", fecha_pago: "2026-10-27", monto: 50 }),               // semana 2
  ch({ id: "e", fecha_pago: "2026-11-16" }),                          // fuera de las 4 semanas
  ch({ id: "f", estado: "cobrado", fecha_pago: "2026-10-10" }),       // debitado: no cuenta
  ch({ id: "g", direccion: "recibido", estado: "en_cartera", fecha_pago: "2026-10-18", monto: 300 }), // para cobrar en fecha
  ch({ id: "h", direccion: "recibido", estado: "en_cartera", fecha_pago: "2026-11-09", monto: 70, moneda: "USD" }), // semana 4
  ch({ id: "i", direccion: "recibido", estado: "endosado", fecha_pago: "2026-10-20" }),
  ch({ id: "j", direccion: "recibido", estado: "rechazado" }),
];

assert.deepEqual(enFecha(cheques, hoy), { pagar: { cantidad: 2, ARS: 200, USD: 0 }, cobrar: { cantidad: 1, ARS: 300, USD: 0 } });
// 26/10/2026: en fecha solo hasta 30 días después de la fecha de pago
assert.equal(enFecha([ch({ id: "v", fecha_pago: "2026-09-19" })], hoy).pagar.cantidad, 1, "30 días justos: en fecha");
assert.equal(enFecha([ch({ id: "v", fecha_pago: "2026-09-18" })], hoy).pagar.cantidad, 0, "más de 30 días: ya no");
// Próxima semana: de mañana a 7 días
const ps = proximaSemana(cheques, hoy);
assert.deepEqual([ps.desde, ps.hasta], ["2026-10-20", "2026-10-26"]);
assert.deepEqual(ps.pagar, { cantidad: 1, ARS: 100, USD: 0 }, "el del 27/10 ya es la otra semana");
assert.equal(ps.cobrar.cantidad, 0, "el endosado no cuenta");

const sem = proximasSemanas(cheques, hoy);
assert.deepEqual(sem.map((s) => [s.desde, s.hasta]), [["2026-10-20", "2026-10-25"], ["2026-10-26", "2026-11-01"], ["2026-11-02", "2026-11-08"], ["2026-11-09", "2026-11-15"]]);
assert.deepEqual(sem.map((s) => s.pagar.ARS), [100, 50, 0, 0]);
assert.deepEqual(sem[3].cobrar, { cantidad: 1, ARS: 0, USD: 70 });
// Domingo: la 1ª semana arranca el lunes
assert.deepEqual(proximasSemanas([], "2026-10-25")[0], { desde: "2026-10-26", hasta: "2026-11-01", pagar: { cantidad: 0, ARS: 0, USD: 0 }, cobrar: { cantidad: 0, ARS: 0, USD: 0 } });

assert.equal(estadoCheque({ direccion: "emitido", estado: "cobrado" }).label, "Debitado");
assert.equal(estadoCheque({ direccion: "recibido", estado: "cobrado" }).label, "Cobrado");
const res = resumenPorEstado(cheques);
assert.deepEqual(res.map((r) => [r.label, r.total.cantidad]), [["Emitido sin debitar", 5], ["Debitado", 1], ["En cartera", 2], ["Endosado", 1], ["Rechazado", 1]]);

console.log("test-cheques-lazza OK");
