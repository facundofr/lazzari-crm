// Prueba rápida: npx tsx scripts/test-cheques-filtro.mjs
import assert from "node:assert/strict";
import { filtrarCheques } from "../src/lib/cheques-filtro.ts";

const cheques = [
  { id: 1, numero: "00000074", banco_emisor: "BANCO DE GALICIA", origen_nombre: "BARRAZA JESICA PAOLA", monto: 7623000, estado: "rechazado", direccion: "recibido", tipo_cheque: "echeq", fecha_pago: "2026-10-05" },
  { id: 2, numero: "3881", banco_emisor: "BANCO GALICIA", origen_nombre: "DEL SOL CONSTRUCTORA S.A.", monto: 3677887.22, estado: "en_cartera", direccion: "recibido", tipo_cheque: "echeq", fecha_pago: "2026-11-20" },
  { id: 3, numero: "555", banco_emisor: "BBVA", destino_nombre: "Proveedor Ñandú", monto: 100000, estado: "pendiente", direccion: "emitido", tipo_cheque: "fisico", fecha_pago: "2026-10-20" },
];
const ids = (r) => r.map((c) => c.id);

assert.deepEqual(ids(filtrarCheques(cheques, {})), [1, 2, 3]);
assert.deepEqual(ids(filtrarCheques(cheques, { texto: "barraza" })), [1]);
assert.deepEqual(ids(filtrarCheques(cheques, { texto: "del sol" })), [2]);
assert.deepEqual(ids(filtrarCheques(cheques, { texto: "nandu" })), [3]);           // sin tildes
assert.deepEqual(ids(filtrarCheques(cheques, { texto: "74" })), [1]);              // número
assert.deepEqual(ids(filtrarCheques(cheques, { texto: "7.623.000" })), [1]);       // importe
assert.deepEqual(ids(filtrarCheques(cheques, { texto: "3.677.887,22" })), [2]);
assert.deepEqual(ids(filtrarCheques(cheques, { texto: "galicia" })), [1, 2]);
assert.deepEqual(ids(filtrarCheques(cheques, { estado: "en_cartera" })), [2]);
assert.deepEqual(ids(filtrarCheques(cheques, { direccion: "emitido" })), [3]);
assert.deepEqual(ids(filtrarCheques(cheques, { tipo: "fisico" })), [3]);
assert.deepEqual(ids(filtrarCheques(cheques, { desde: "2026-10-10", hasta: "2026-10-31" })), [3]);

// Por defecto, solo pendientes (a pagar, en cartera, depositados): lo cobrado/anulado es historial.
{
  const { ESTADO_PENDIENTES } = await import("../src/lib/cheques-filtro.ts");
  const cs = [{ id: 1, estado: "entregado" }, { id: 2, estado: "cobrado" }, { id: 3, estado: "en_cartera" }, { id: 4, estado: "anulado" }, { id: 5, estado: "depositado" }];
  assert.deepEqual(filtrarCheques(cs, { estado: ESTADO_PENDIENTES }).map((c) => c.id), [1, 3, 5]);
  assert.equal(filtrarCheques(cs, { estado: "" }).length, 5);
}
console.log("cheques-filtro OK");
