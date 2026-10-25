// Prueba rápida: npx tsx scripts/test-cheques-estado-banco.ts
import assert from "node:assert/strict";
import { diferenciaConBanco } from "../src/lib/cheques-estado-banco";

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

console.log("test-cheques-estado-banco OK");
