// Prueba rápida: npx tsx scripts/test-cheques-estado-banco.ts
import assert from "node:assert/strict";
import { diferenciaConBanco, cambioSegunBanco, cambiosDeLaCarga, abiertosFueraDelReporte, fechaDelReporte } from "../src/lib/cheques-estado-banco";

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

// 26/10/2026 (tanda 2): eCheqs propios abiertos del CRM que no vinieron en los reportes de emitidos
assert.equal(fechaDelReporte("23-10-2026-eCheqs-emitidos (1).xls"), "2026-10-23");
assert.equal(fechaDelReporte("emitidos.xls"), null);
const abiertos = [
  { id: "p1", cheq_id: "E1", numero: "90017096", monto: 733617.1, direccion: "emitido", estado: "entregado", tipo_cheque: "echeq", fecha_emision: "2026-07-22", fecha_pago: "2026-10-31" },
  { id: "p2", cheq_id: "E2", numero: "90017104", monto: 500000, direccion: "emitido", estado: "entregado", tipo_cheque: "echeq", fecha_emision: "2026-07-27", fecha_pago: "2026-10-30" },
  { id: "p3", cheq_id: null, numero: "90017380", monto: 1415000, direccion: "emitido", estado: "entregado", tipo_cheque: "echeq", fecha_emision: "2026-10-13", fecha_pago: "2026-11-11" }, // sin CheqID: por número + monto
  { id: "p4", cheq_id: "E4", numero: "90000172", monto: 91234, direccion: "emitido", estado: "pendiente", tipo_cheque: "echeq", fecha_emision: "2026-10-02", fecha_pago: "2026-10-31" }, // viene en anulados
  { id: "p5", cheq_id: null, numero: "1234", monto: 5000, direccion: "emitido", estado: "entregado", tipo_cheque: "fisico", fecha_emision: "2026-10-01", fecha_pago: "2026-11-01" }, // físico: no se mira
  { id: "p6", cheq_id: null, numero: "90017420", monto: 100, direccion: "emitido", estado: "entregado", tipo_cheque: "echeq", fecha_emision: "2026-10-24", fecha_pago: "2026-11-30" }, // emitido después del reporte
  { id: "p7", cheq_id: "E7", numero: "90017001", monto: 10, direccion: "emitido", estado: "cobrado", tipo_cheque: "echeq", fecha_emision: "2026-07-01", fecha_pago: "2026-08-01" }, // cerrado: no se mira
  { id: "r1", cheq_id: "R1", numero: "3881", monto: 1000, direccion: "recibido", estado: "en_cartera", tipo_cheque: "echeq", fecha_emision: "2026-10-01", fecha_pago: "2026-11-01" }, // recibido: no se mira
];
const repEmitidos = { archivo: "23-10-2026-eCheqs-emitidos.xls", tipo: "emitidos", direccion: "emitido", filas: [{ cheqId: "E1", numero: "90017096", monto: 733617.1 }, { cheqId: "ZZ", numero: "90017380", monto: 1415000 }] };
const repAnulados = { archivo: "23-10-2026-eCheqs-anulados.xls", tipo: "anulados", direccion: "emitido", filas: [{ cheqId: "E4", numero: "90000172", monto: 91234 }] };
// Sin reporte de emitidos: no hay control
assert.equal(abiertosFueraDelReporte([repAnulados], abiertos), null);
assert.equal(abiertosFueraDelReporte([], abiertos), null);
// Con emitidos: falta solo el 90017104 (como los de Prisina con el reporte de 300)
assert.deepEqual(abiertosFueraDelReporte([repEmitidos, repAnulados], abiertos)?.map((c) => c.id), ["p2"]);
// Sin fecha en el nombre: también entra el emitido después
assert.deepEqual(abiertosFueraDelReporte([{ ...repEmitidos, archivo: "emitidos.xls" }, repAnulados], abiertos)?.map((c) => c.id), ["p2", "p6"]);

console.log("test-cheques-estado-banco OK");
