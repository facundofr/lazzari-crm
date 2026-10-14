// Prueba rápida de lib/pendientes.ts. Uso (desde crm/app): npx tsx scripts/test-pendientes.ts
import assert from "node:assert/strict";
import { agruparPendientes, textoRespuestas, linkInterno, type PendienteItem } from "../src/lib/pendientes";

const base = { tipo: "hacer" as const, link: null, respuesta: null, completado: false, fecha_vencimiento: null };
const items: PendienteItem[] = [
  { ...base, id: "1", texto: "Pregunta de decisiones", area: "Decisiones", created_at: "2026-10-14T10:00:00Z", respuesta: "Sí, dale" },
  { ...base, id: "2", texto: "Hacer OP", area: "Pagos", created_at: "2026-10-14T11:00:00Z" },
  { ...base, id: "3", texto: "Sin área", area: null, created_at: "2026-10-14T09:00:00Z" },
  { ...base, id: "4", texto: "Pago con fecha", area: "Pagos", created_at: "2026-10-14T12:00:00Z", fecha_vencimiento: "2026-10-20" },
  { ...base, id: "5", texto: "Ya hecho", area: "Pagos", created_at: "2026-10-14T08:00:00Z", completado: true, respuesta: "listo" },
  { ...base, id: "6", texto: "Varias líneas", area: "Cobros", created_at: "2026-10-14T08:00:00Z", respuesta: "uno\n dos" },
];

const g = agruparPendientes(items);
assert.deepEqual(g.map((x) => x.area), ["Pagos", "Cobros", "Decisiones", "Otros"]);
assert.deepEqual(g[0].items.map((x) => x.id), ["4", "5", "2"]); // con fecha primero, después por carga

const t = textoRespuestas(items, { sociedad: "Lazzari" });
assert.ok(t.startsWith("Respuestas de Pendientes (Lazzari):"));
assert.ok(!t.includes("Ya hecho"), "los completados no se copian");
assert.ok(t.includes("1. Pago con fecha\n   → (sin responder)"));
assert.ok(t.includes("→ uno / dos"), "respuesta en una línea");
assert.ok(t.includes("→ Sí, dale"));

const solo = textoRespuestas(items, { soloRespondidos: true });
assert.ok(solo.includes("Pregunta de decisiones") && !solo.includes("Hacer OP"));
assert.ok(textoRespuestas([]).includes("(no hay pendientes abiertos)"));

assert.equal(linkInterno("/finanzas?tab=ordenes_pago"), "/finanzas?tab=ordenes_pago");
assert.equal(linkInterno("https://otro.com"), null);
assert.equal(linkInterno("//otro.com"), null);
assert.equal(linkInterno(null), null);

console.log("test-pendientes OK");
