import assert from "node:assert/strict";
import { fechaHoraAR, textoEnvio, enviosPorPR } from "../src/lib/presupuesto-envios";

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

console.log("OK: envíos por mail del PR (fecha de Argentina, quién, a quién, todos los envíos).");
