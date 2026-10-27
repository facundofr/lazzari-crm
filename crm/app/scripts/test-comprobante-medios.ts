import assert from "node:assert/strict";
import { claveArchivo, mismaRetencion, mismoPago, sinRepetir, type PagoComparable, type RetencionComparable } from "../src/lib/comprobante-medios";

// Mismo pago
assert.equal(mismoPago({ tipo: "transferencia", monto: 100, fecha: "2026-10-26" }, { tipo: "transferencia", monto: 100.004, fecha: "2026-10-26" }), true, "misma transferencia");
assert.equal(mismoPago({ tipo: "transferencia", monto: 100, fecha: "2026-10-26" }, { tipo: "deposito", monto: 100, fecha: "2026-10-26" }), true, "transferencia y depósito son la misma familia");
assert.equal(mismoPago({ tipo: "transferencia", monto: 100, fecha: "2026-10-26" }, { tipo: "transferencia", monto: 100, fecha: "2026-10-27" }), false, "otra fecha");
assert.equal(mismoPago({ tipo: "transferencia", monto: 100, fecha: "2026-10-26" }, { tipo: "transferencia", monto: 101, fecha: "2026-10-26" }), false, "otro importe");
assert.equal(mismoPago({ tipo: "echeq", monto: 500, numero: "00090017248" }, { tipo: "cheque_propio", monto: 500, numero: "90017248" }), true, "mismo cheque, con y sin ceros");
assert.equal(mismoPago({ tipo: "echeq", monto: 500, numero: "90017248", fecha: "2026-11-01" }, { tipo: "echeq", monto: 500, numero: "90017249", fecha: "2026-11-01" }), false, "dos cheques del mismo importe y fecha");
assert.equal(mismoPago({ tipo: "transferencia", monto: 500, numero: "", fecha: "2026-10-26" }, { tipo: "transferencia", monto: 500, numero: "778899", fecha: "2026-10-26" }), true, "la OP sin número y el aviso del banco con número: decide la fecha");
assert.equal(mismoPago({ tipo: "echeq", monto: 500, numero: "90017248", fecha: "2026-11-01" }, { tipo: "echeq", monto: 500, numero: "", fecha: "2026-11-15" }), false, "uno sin número y otra fecha: es otro");
assert.equal(mismoPago({ tipo: "transferencia", monto: 0 }, { tipo: "transferencia", monto: 0 }), false, "un renglón vacío nunca es repetido");
assert.equal(mismoPago({ tipo: "efectivo", monto: 100, fecha: "2026-10-26" }, { tipo: "transferencia", monto: 100, fecha: "2026-10-26" }), false, "otro medio");

// Misma retención
const ret = (x: Partial<RetencionComparable>): RetencionComparable => ({ tipo: "retencion_iibb", monto: 1234.56, ...x });
assert.equal(mismaRetencion(ret({}), ret({})), true);
assert.equal(mismaRetencion(ret({ certificado: "0001-123" }), ret({ certificado: "0001123" })), true, "mismo certificado escrito distinto");
assert.equal(mismaRetencion(ret({ certificado: "123" }), ret({})), true, "uno sin certificado: igual tipo e importe");
assert.equal(mismaRetencion(ret({ certificado: "123" }), ret({ certificado: "124" })), false, "otro certificado");
assert.equal(mismaRetencion(ret({}), ret({ tipo: "retencion_ganancias" })), false, "otro impuesto");

// Sin repetir: cada cargado cuenta una sola vez
const t = (monto: number): PagoComparable => ({ tipo: "transferencia", monto, fecha: "2026-10-26" });
const r1 = sinRepetir([t(100)], [t(100), t(100), t(50)], mismoPago);
assert.deepEqual(r1.repetidos.map((x) => x.monto), [100], "una sola de las dos iguales ya estaba");
assert.deepEqual(r1.agregar.map((x) => x.monto), [100, 50]);
const r2 = sinRepetir([t(100), t(50)], [t(100), t(50)], mismoPago);
assert.equal(r2.agregar.length, 0, "volver a subir el mismo comprobante no suma nada");
assert.equal(r2.repetidos.length, 2);
const r3 = sinRepetir([], [t(100)], mismoPago);
assert.deepEqual(r3, { agregar: [t(100)], repetidos: [] }, "sin nada cargado entra todo");

assert.equal(claveArchivo({ name: "comprobante.pdf", size: 1234 }), "comprobante.pdf|1234");

console.log("test-comprobante-medios: OK");
