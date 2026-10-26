// Prueba rápida: npx tsx scripts/test-cheques-estado-banco.ts
import assert from "node:assert/strict";
import { diferenciaConBanco, cambioSegunBanco, cambiosDeLaCarga } from "../src/lib/cheques-estado-banco";

// Sin estado del banco: no hay nada que comparar
assert.equal(diferenciaConBanco("emitido", "entregado", null), null);
assert.equal(diferenciaConBanco("emitido", "entregado", ""), null);
// Coinciden
assert.equal(diferenciaConBanco("emitido", "cobrado", "PAGADO"), null);
assert.equal(diferenciaConBanco("recibido", "cobrado", "PAGADO"), null);
assert.equal(diferenciaConBanco("recibido", "endosado", "PAGADO"), null); // lo cobró el que lo recibió por endoso
assert.equal(diferenciaConBanco("recibido", "rechazado", "RECHAZADO"), null);
assert.equal(diferenciaConBanco("emitido", "anulado", "ANULADO"), null);
// Estados intermedios del banco: no se comparan
assert.equal(diferenciaConBanco("recibido", "en_cartera", "ACTIVO"), null);
assert.equal(diferenciaConBanco("emitido", "entregado", "ACTIVO_PENDIENTE"), null);
assert.equal(diferenciaConBanco("emitido", "entregado", "CUSTODIA"), null);
assert.equal(diferenciaConBanco("recibido", "en_cartera", "PRESENTADO"), null);
assert.equal(diferenciaConBanco("recibido", "en_cartera", "DEPOSITADO"), null);
// Diferencias
assert.ok(diferenciaConBanco("emitido", "entregado", "PAGADO")?.includes("ya lo pagó"));
assert.ok(diferenciaConBanco("emitido", "pendiente", "PAGADO"));
assert.ok(diferenciaConBanco("recibido", "en_cartera", "PAGADO")?.includes("en cartera"));
assert.ok(diferenciaConBanco("recibido", "cobrado", "RECHAZADO")?.includes("rechazado"));
assert.ok(diferenciaConBanco("emitido", "entregado", "ANULADO")?.includes("anulado"));
// Mayúsculas y espacios
assert.ok(diferenciaConBanco("emitido", "Entregado", " pagado "));

// 26/10/2026: el banco actualiza el CRM (misma regla que actualizar_cheques_segun_banco)
assert.equal(cambioSegunBanco("emitido", "entregado", "PAGADO")?.a, "cobrado");
assert.equal(cambioSegunBanco("emitido", "pendiente", "PAGADO")?.a, "cobrado");
assert.equal(cambioSegunBanco("emitido", "cobrado", "PAGADO"), null);
assert.equal(cambioSegunBanco("recibido", "en_cartera", "PAGADO")?.a, "cobrado");
assert.equal(cambioSegunBanco("recibido", "endosado", "PAGADO"), null); // endosados no se tocan
assert.equal(cambioSegunBanco("recibido", "endosado", "RECHAZADO"), null);
assert.ok(cambioSegunBanco("recibido", "cobrado", "RECHAZADO")?.aviso?.includes("anula el cobro"));
assert.equal(cambioSegunBanco("recibido", "rechazado", "RECHAZADO"), null);
assert.equal(cambioSegunBanco("emitido", "entregado", "RECHAZADO")?.a, "rechazado");
assert.equal(cambioSegunBanco("emitido", "entregado", "ANULADO")?.a, "anulado");
assert.equal(cambioSegunBanco("emitido", "cobrado", "ANULADO"), null);
assert.equal(cambioSegunBanco("recibido", "en_cartera", "ACTIVO"), null); // intermedio
assert.equal(cambioSegunBanco("emitido", "entregado", "CUSTODIA"), null);
const crm = [
  { id: "a", cheq_id: "X1", numero: "90017313", monto: 68736.2, direccion: "emitido", estado: "entregado" },
  { id: "b", cheq_id: null, numero: "00003881", monto: "1000", direccion: "recibido", estado: "en_cartera" },
  { id: "c", cheq_id: null, numero: "55", monto: 10, direccion: "recibido", estado: "en_cartera" },
  { id: "d", cheq_id: null, numero: "55", monto: 10, direccion: "recibido", estado: "en_cartera" },
];
const cambios = cambiosDeLaCarga([
  { cheq_id: "X1", numero: "90017313", monto: 68736.2, direccion: "emitido", estado_banco: "PAGADO" },
  { cheq_id: "Z9", numero: "3881", monto: 1000, direccion: "recibido", estado_banco: "RECHAZADO" },
  { cheq_id: "Z8", numero: "55", monto: 10, direccion: "recibido", estado_banco: "RECHAZADO" }, // dos iguales en el CRM: no se elige
  { cheq_id: "Z7", numero: "77", monto: 5, direccion: "recibido", estado_banco: "RECHAZADO" }, // no está en el CRM
], crm);
assert.deepEqual(cambios.map((c) => `${c.cheque.id}:${c.a}`), ["a:cobrado", "b:rechazado"]);

console.log("test-cheques-estado-banco OK");
