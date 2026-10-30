import assert from "node:assert/strict";
import { estadoDesdeResend, estadoFinal, hayQueVerificar, nombreDocumento, avisoRebote, programarPara, validarProgramado, mananaALas9 } from "../src/lib/correos-enviados";

// Estado de Resend → CRM
assert.equal(estadoDesdeResend("delivered"), "entregado");
assert.equal(estadoDesdeResend("opened"), "entregado");
assert.equal(estadoDesdeResend("bounced"), "rebotado");
assert.equal(estadoDesdeResend("complained"), "spam");
assert.equal(estadoDesdeResend("delivery_delayed"), "demorado");
assert.equal(estadoDesdeResend("sent"), "enviado");
assert.equal(estadoDesdeResend(null), "enviado");
assert.equal(estadoFinal("entregado"), true);
assert.equal(estadoFinal("demorado"), false);

// Cuándo se vuelve a consultar
const ahora = new Date("2026-10-28T20:00:00Z").getTime();
const base = { enviado_at: "2026-10-28T19:00:00Z", verificado_at: null, resend_id: "r1" };
assert.equal(hayQueVerificar({ ...base, estado: "enviado" }, ahora), true);
assert.equal(hayQueVerificar({ ...base, estado: "demorado" }, ahora), true);
assert.equal(hayQueVerificar({ ...base, estado: "entregado" }, ahora), false);
assert.equal(hayQueVerificar({ ...base, estado: "enviado", resend_id: null }, ahora), false);
assert.equal(hayQueVerificar({ ...base, estado: "enviado", verificado_at: "2026-10-28T19:58:00Z" }, ahora), false); // mirado hace 2 min
assert.equal(hayQueVerificar({ ...base, estado: "enviado", verificado_at: "2026-10-28T19:50:00Z" }, ahora), true);
assert.equal(hayQueVerificar({ ...base, estado: "enviado", enviado_at: "2026-10-20T19:00:00Z" }, ahora), false); // más de 7 días

// Documento y aviso
assert.equal(nombreDocumento({ documento_tipo: "presupuesto", documento_nombre: "PR-2026-1285.pdf" }), "PR-2026-1285");
assert.equal(nombreDocumento({ documento_tipo: "orden_compra", documento_nombre: null }), "OC");
assert.equal(nombreDocumento({ documento_tipo: null, documento_nombre: "" }), "Mail");
const a = avisoRebote({ enviado_at: "2026-10-28T17:32:00Z", enviado_a: "x@y.com", documento_tipo: "presupuesto", documento_nombre: "PR-2026-1285.pdf", estado: "rebotado" });
assert.equal(a.title, "Mail que no llegó: PR-2026-1285");
assert.match(a.description, /28\/10\/2026 14:32 mandaste PR-2026-1285 a x@y.com y no llegó/);
assert.match(avisoRebote({ ...{ enviado_at: "2026-10-28T17:32:00Z", enviado_a: "x@y.com", documento_tipo: "remito", documento_nombre: null }, estado: "spam" }).description, /spam/);

console.log("OK: correos enviados (estado de Resend, cuándo verificar, aviso de rebote).");

// Mails programados (29/10/2026)
assert.equal(estadoDesdeResend("scheduled"), "programado");
assert.equal(estadoDesdeResend("canceled"), "cancelado");
assert.equal(estadoFinal("cancelado"), true);
assert.equal(estadoFinal("programado"), false);
assert.equal(hayQueVerificar({ ...base, estado: "programado", enviado_at: "2026-10-29T12:00:00Z" }, ahora), false); // sale mañana
assert.equal(hayQueVerificar({ ...base, estado: "programado", enviado_at: "2026-10-28T19:00:00Z" }, ahora), true); // ya tendría que haber salido
// ahora = 28/10 17:00 en Argentina
assert.deepEqual(programarPara("2026-10-29", "09:00", ahora), { iso: "2026-10-29T12:00:00.000Z" });
assert.ok("error" in programarPara("2026-10-28", "16:00", ahora)); // ya pasó
assert.ok("error" in programarPara("2026-10-28", "17:01", ahora)); // menos de 2 minutos
assert.ok("error" in programarPara("2026-12-01", "09:00", ahora)); // más de 30 días
assert.ok("error" in programarPara("", "09:00", ahora));
assert.ok("error" in validarProgramado("cualquier cosa", ahora));
assert.deepEqual(mananaALas9("2026-10-31"), { fecha: "2026-11-01", hora: "09:00" });
console.log("programados OK");
