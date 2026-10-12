// Prueba rápida de src/lib/oc-reclamos.ts. Uso: npx tsx scripts/test-oc-reclamos.mjs
import assert from "node:assert/strict";
import { diasEntre, ocAReclamar, avisoAtrasoOC } from "../src/lib/oc-reclamos.ts";

const base = { activa: true, pagada: false, recibidaCompleta: false, fecha: "2026-10-01", pagadaAt: null };
assert.equal(diasEntre("2026-10-01", "2026-10-12"), 11);
assert.equal(diasEntre("2026-10-12T15:00:00Z", "2026-10-12"), 0);
assert.equal(ocAReclamar(base), false);
assert.equal(ocAReclamar({ ...base, pagada: true }), true);
assert.equal(ocAReclamar({ ...base, pagada: true, recibidaCompleta: true }), false);
assert.equal(ocAReclamar({ ...base, pagada: true, activa: false }), false);
assert.equal(avisoAtrasoOC(base, "2026-10-12"), null);
assert.deepEqual(avisoAtrasoOC(base, "2026-11-05"), { tipo: "sin_recibir", dias: 35 });
assert.deepEqual(avisoAtrasoOC({ ...base, pagada: true, pagadaAt: "2026-10-02T15:00:00Z" }, "2026-10-12"), { tipo: "pagada_sin_recibir", dias: 10 });
assert.equal(avisoAtrasoOC({ ...base, pagada: true, pagadaAt: "2026-10-08" }, "2026-10-12"), null);
assert.equal(avisoAtrasoOC({ ...base, recibidaCompleta: true }, "2027-01-01"), null);
assert.equal(avisoAtrasoOC({ ...base, activa: false }, "2027-01-01"), null);
console.log("OK test-oc-reclamos");
