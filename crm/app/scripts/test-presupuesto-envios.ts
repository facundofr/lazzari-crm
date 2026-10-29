import assert from "node:assert/strict";
import { fechaHoraAR, textoEnvio, enviosPorPR, sugerenciasMailPR, esContactoDeFacturacion } from "../src/lib/presupuesto-envios";

// Hora de Argentina (UTC−3), también pasada la medianoche UTC
assert.equal(fechaHoraAR("2026-10-28T17:32:00Z"), "28/10/2026 14:32");
assert.equal(fechaHoraAR("2026-10-29T01:05:00Z"), "28/10/2026 22:05");
assert.equal(fechaHoraAR("no es fecha"), "—");

const nombres: Record<string, string> = { u1: "Sebastian" };
const nombre = (id: string | null) => (id ? nombres[id] : null);
assert.equal(textoEnvio({ presupuesto_id: "p", enviado_at: "2026-10-28T17:32:00Z", enviado_por: "u1", enviado_a: "a@b.com" }, nombre),
  "28/10/2026 14:32 · Sebastian → a@b.com");
assert.equal(textoEnvio({ presupuesto_id: "p", enviado_at: "2026-10-28T17:32:00Z", enviado_por: "otro", enviado_a: "a@b.com" }, nombre),
  "28/10/2026 14:32 · — → a@b.com");

assert.equal(textoEnvio({ presupuesto_id: "p", enviado_at: "2026-10-28T17:32:00Z", enviado_por: "u1", enviado_a: "a@b.com", estadoTexto: "Rebotó" }, nombre),
  "28/10/2026 14:32 · Sebastian → a@b.com · Rebotó");

// Varios envíos del mismo PR: quedan todos, el más nuevo primero
const m = enviosPorPR([
  { presupuesto_id: "p1", enviado_at: "2026-10-27T10:00:00Z", enviado_por: "u1", enviado_a: "x@y.com" },
  { presupuesto_id: "p2", enviado_at: "2026-10-28T10:00:00Z", enviado_por: "u1", enviado_a: "z@y.com" },
  { presupuesto_id: "p1", enviado_at: "2026-10-28T12:00:00Z", enviado_por: "u1", enviado_a: "x@y.com, w@y.com" },
]);
assert.equal(m.get("p1")?.length, 2);
assert.equal(m.get("p1")?.[0].enviado_a, "x@y.com, w@y.com");
assert.equal(m.get("p2")?.length, 1);
assert.equal(m.get("p3"), undefined);

// Mails sugeridos al enviar: solicitante primero, contactos (sucursal del PR primero), nunca facturación.
const contactos = [
  { email: "ana@cli.com", nombre: "Ana", cargo: "Compras", sucursal_id: "s2" },
  { email: "juan@cli.com", nombre: "Juan", cargo: null, sucursal_id: "s1" },
  { email: null, nombre: "Sin mail", sucursal_id: "s1" },
  { email: "PEPE@cli.com", nombre: "Pepe", sucursal_id: "s1" },
];
let sg = sugerenciasMailPR({ solicitante: { email: "pepe@cli.com", nombre: "Pepe" }, contactos, sucursalId: "s1", emailCliente: "info@cli.com" });
assert.equal(sg.para, "pepe@cli.com");
assert.deepEqual(sg.sugeridos.map((s) => s.email), ["pepe@cli.com", "juan@cli.com", "ana@cli.com", "info@cli.com"]);
assert.equal(sg.sugeridos[2].label, "Ana · Compras");
// Sin solicitante: nada elegido solo; se muestran todos los contactos con mail.
sg = sugerenciasMailPR({ solicitante: null, contactos, sucursalId: "s1" });
assert.equal(sg.para, "");
assert.deepEqual(sg.sugeridos.map((s) => s.email), ["juan@cli.com", "PEPE@cli.com", "ana@cli.com"]);
// Un contacto con el mismo mail que facturación no se sugiere.
sg = sugerenciasMailPR({ solicitante: null, contactos, sucursalId: "s1", emailsFacturacion: "x@y.com, ANA@cli.com" });
assert.deepEqual(sg.sugeridos.map((s) => s.email), ["juan@cli.com", "PEPE@cli.com"]);

// Contactos de pagos/administración tampoco (ej. "Cuentas por pagar" de Corteva).
sg = sugerenciasMailPR({ solicitante: null, contactos: [...contactos, { email: "faeeinv@corteva.com", nombre: "Cuentas por pagar" }, { email: "f@a.com", nombre: "Federico", cargo: "ADMINISTRACION" }] });
assert.deepEqual(sg.sugeridos.map((s) => s.email), ["ana@cli.com", "juan@cli.com", "PEPE@cli.com"]);
assert.equal(esContactoDeFacturacion({ nombre: "Facturas a pagar" }), true);
assert.equal(esContactoDeFacturacion({ nombre: "Proveedores Synthon" }), true);
assert.equal(esContactoDeFacturacion({ nombre: "Miqueas Ramirez", cargo: "COMPRAS" }), false);

console.log("OK: envíos por mail del PR (fecha de Argentina, quién, a quién, todos los envíos).");
