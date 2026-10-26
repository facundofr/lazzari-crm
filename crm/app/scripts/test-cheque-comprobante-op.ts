// Prueba rápida: npx tsx scripts/test-cheque-comprobante-op.ts
import assert from "node:assert/strict";
import { chequeDelComprobante, chequeLibreParaOp, numeroSinCeros, type ChequeCandidato } from "../src/lib/cheque-comprobante-op";

const PROV = "prov-1";
const crm: ChequeCandidato[] = [
  { id: "c1", numero: "00003587", monto: 1348076.59, moneda: "ARS", direccion: "recibido", estado: "en_cartera", origen_nombre: "DEL SOL" },
  { id: "c2", numero: "211", monto: "619580.50", moneda: "ARS", direccion: "recibido", estado: "endosado", destino_id: PROV, enOpVigente: false }, // OP anulada
  { id: "c3", numero: "168", monto: 837459.15, moneda: "ARS", direccion: "recibido", estado: "endosado", destino_id: "otro", enOpVigente: true },
  { id: "p1", numero: "90017372", monto: 1365403.77, moneda: "ARS", direccion: "emitido", estado: "pendiente" },
  { id: "p2", numero: "90017380", monto: 1415000, moneda: "ARS", direccion: "emitido", estado: "entregado", destino_id: PROV, enOpVigente: false }, // OP anulada
  { id: "p3", numero: "90017406", monto: 500, moneda: "ARS", direccion: "emitido", estado: "entregado", destino_id: PROV, enOpVigente: true },
  { id: "p4", numero: "90017500", monto: 100, moneda: "ARS", direccion: "emitido", estado: "cobrado" },
];

assert.equal(numeroSinCeros("00003587"), "3587");
assert.equal(numeroSinCeros(" 0000 0211 "), "211");
assert.equal(chequeLibreParaOp(crm[0], PROV), true);
assert.equal(chequeLibreParaOp(crm[1], PROV), true);
assert.equal(chequeLibreParaOp(crm[1], "otro"), false);
assert.equal(chequeLibreParaOp(crm[2], "otro"), false); // en una OP vigente

// Endoso de un cheque en cartera (comprobante "eCheq Endosado" de Del Sol)
let r = chequeDelComprobante({ numero: "00003587", monto: 1348076.59, moneda: "ARS", direccion: "recibido" }, crm, PROV);
assert.equal(r.tipo, "cartera"); assert.equal(r.tipo === "cartera" && r.cheque.id, "c1");
// Aunque la IA no diga que es endoso, si está en cartera con ese número y monto, es ese
r = chequeDelComprobante({ numero: "3587", monto: 1348076.59, moneda: "ARS", direccion: "emitido" }, crm, PROV);
assert.equal(r.tipo, "cartera");
// Endosado a este proveedor en una OP anulada: se usa el mismo
r = chequeDelComprobante({ numero: "00000211", monto: 619580.5, moneda: "ARS", direccion: "recibido" }, crm, PROV);
assert.equal(r.tipo, "cartera"); assert.ok(r.aviso?.includes("sin una OP vigente"));
// Endosado a otro en una OP vigente: no se usa, aviso
r = chequeDelComprobante({ numero: "168", monto: 837459.15, moneda: "ARS", direccion: "recibido" }, crm, PROV);
assert.equal(r.tipo, "endoso_sin_cheque"); assert.ok(r.aviso.includes("otra OP vigente"));
// Endoso de un cheque que no está en el CRM
r = chequeDelComprobante({ numero: "4444", monto: 10, moneda: "ARS", direccion: "recibido" }, crm, PROV);
assert.equal(r.tipo, "endoso_sin_cheque"); assert.ok(r.aviso.includes("no está en cartera"));
// Endoso con otro monto
r = chequeDelComprobante({ numero: "3587", monto: 1348000, moneda: "ARS", direccion: "recibido" }, crm, PROV);
assert.equal(r.tipo, "endoso_sin_cheque"); assert.ok(r.aviso.includes("otro monto"));

// eCheq propio ya cargado pendiente: se usa ese
r = chequeDelComprobante({ numero: "90017372", monto: 1365403.77, moneda: "ARS", direccion: "emitido" }, crm, PROV);
assert.equal(r.tipo, "propio_existente"); assert.equal(r.aviso, null);
// eCheq propio de una OP anulada al mismo proveedor: no se duplica
r = chequeDelComprobante({ numero: "90017380", monto: 1415000, moneda: "ARS", direccion: "emitido" }, crm, PROV);
assert.equal(r.tipo, "propio_existente"); assert.equal(r.tipo === "propio_existente" && r.cheque.id, "p2");
// El mismo cheque, pero para OTRO proveedor: no se usa
r = chequeDelComprobante({ numero: "90017380", monto: 1415000, moneda: "ARS", direccion: "emitido" }, crm, "prov-2");
assert.equal(r.tipo, "propio_nuevo"); assert.ok(r.aviso?.includes("a otro proveedor"));
// Ya usado en una OP vigente: aviso
r = chequeDelComprobante({ numero: "90017406", monto: 500, moneda: "ARS", direccion: "emitido" }, crm, PROV);
assert.equal(r.tipo, "propio_nuevo"); assert.ok(r.aviso?.includes("otra OP vigente"));
// Cobrado: aviso
r = chequeDelComprobante({ numero: "90017500", monto: 100, moneda: "ARS", direccion: "emitido" }, crm, PROV);
assert.equal(r.tipo, "propio_nuevo"); assert.ok(r.aviso?.includes("cobrado"));
// eCheq propio nuevo (no está): como hasta ahora, sin aviso
r = chequeDelComprobante({ numero: "90017999", monto: 1, moneda: "ARS", direccion: "emitido" }, crm, PROV);
assert.deepEqual(r, { tipo: "propio_nuevo", aviso: null });
// Ya usado en otro medio de la misma OP: no se repite
r = chequeDelComprobante({ numero: "90017372", monto: 1365403.77, moneda: "ARS", direccion: "emitido" }, crm, PROV, ["p1"]);
assert.equal(r.tipo, "propio_nuevo");
// Otra moneda: no coincide
r = chequeDelComprobante({ numero: "90017372", monto: 1365403.77, moneda: "USD", direccion: "emitido" }, crm, PROV);
assert.equal(r.tipo, "propio_nuevo");

console.log("test-cheque-comprobante-op OK");
