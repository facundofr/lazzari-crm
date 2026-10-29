// Prueba de lib/premios-lazza.ts — npx tsx scripts/test-premios-lazza.ts
import assert from "node:assert/strict";
import { premioDelMes, premiosPorCargar, detallePremio, nombreMesPremio, mesAnterior, mesSiguiente, PERSONAS_PREMIO } from "../src/lib/premios-lazza";

assert.equal(PERSONAS_PREMIO.length, 4);
// Sin premio por debajo de bueno (el mínimo de $ 64 M no paga)
assert.deepEqual(premioDelMes(50_000_000), { nivel: "debajo", porPersona: 0, personas: PERSONAS_PREMIO, total: 0 });
assert.equal(premioDelMes(64_000_000).porPersona, 0);
assert.equal(premioDelMes(79_999_999.99).porPersona, 0);
// Bueno: $ 200.000 c/u; muy bueno: $ 400.000 c/u
assert.equal(premioDelMes(80_000_000).porPersona, 200_000);
assert.equal(premioDelMes(80_000_000).total, 800_000);
assert.equal(premioDelMes(95_999_999).porPersona, 200_000);
assert.equal(premioDelMes(96_000_000).porPersona, 400_000);
assert.equal(premioDelMes(130_000_000).total, 1_600_000);
// Meses
assert.equal(nombreMesPremio("2026-10"), "octubre");
assert.equal(mesAnterior("2026-01"), "2025-12");
assert.equal(mesAnterior("2026-11"), "2026-10");
assert.equal(mesSiguiente("2026-12"), "2027-01");
assert.equal(detallePremio("2026-10", "Mariana Santinelli"), "Premio octubre — Mariana Santinelli");
// Qué falta cargar
assert.deepEqual(premiosPorCargar("2026-10", 50_000_000, []), []);
const todos = premiosPorCargar("2026-10", 85_000_000, []);
assert.equal(todos.length, 4);
assert.ok(todos.every((x) => x.monto === 200_000));
const faltan = premiosPorCargar("2026-10", 97_000_000, ["Premio octubre — Jerónimo Casadidio", "premio octubre — mariana santinelli "]);
assert.deepEqual(faltan.map((x) => x.persona), ["Sebastián Pereyra", "Augusto Lazzari"]);
assert.ok(faltan.every((x) => x.monto === 400_000));
// Otro mes: no se mezcla
assert.equal(premiosPorCargar("2026-11", 97_000_000, ["Premio octubre — Jerónimo Casadidio"]).length, 4);
console.log("test-premios-lazza OK");
