// Prueba de lib/precios-ia (auditoría P09): npx tsx scripts/test-precios-ia.ts
import assert from "node:assert/strict";
import { costoIAUSD, precioIA } from "../src/lib/precios-ia";
import { costoModeloUSD } from "../src/lib/agente-mail";
import { costoUSD as costoTopeAyuda } from "../src/lib/ia-tope";

const p = (modelo: string | null) => { const x = precioIA(modelo); return `${x.entrada}/${x.salida}`; };

// Los que usa el CRM
assert.equal(p("claude-opus-5-5"), "4/20");
assert.equal(p("claude-sonnet-5-5"), "2/10");
assert.equal(p("claude-haiku-4-5-20251001"), "1/5");
assert.equal(p("claude-sonnet-4-5"), "3/15");

// El prefijo más específico gana
assert.equal(p("claude-opus-5"), "5/25");
assert.equal(p("claude-sonnet-5"), "2/10");
assert.equal(p("claude-haiku-5-5"), "0.1/0.5");
assert.equal(p("claude-fable-5-1"), "10/50");

// Desconocido: su familia actual; sin modelo, Opus 5.5
assert.equal(p("claude-opus-9"), "4/20");
assert.equal(p(null), "4/20");

// Costo
assert.equal(costoIAUSD("claude-opus-5-5", 1_000_000, 1_000_000), 24);
assert.equal(costoIAUSD("claude-haiku-4-5", 1_000_000, 0), 1);
// Las otras dos cuentas usan la misma tabla
assert.equal(costoModeloUSD("claude-opus-5-5", 1_000_000, 1_000_000), 24);
assert.equal(costoTopeAyuda(1_000_000, 1_000_000), 6);

// Octubre 2026 (tokens de ia_uso): Opus 5.5 3.004.969 / 234.427 · Haiku 4.5 1.315.141 / 136.812 · Sonnet 4.5 249.453 / 4.976
const oct = costoIAUSD("claude-opus-5-5", 3004969, 234427) + costoIAUSD("claude-haiku-4-5-20251001", 1315141, 136812) + costoIAUSD("claude-sonnet-4-5", 249453, 4976);
assert.ok(Math.abs(oct - 19.53) < 0.01, `octubre ${oct}`);

console.log("test-precios-ia OK");
