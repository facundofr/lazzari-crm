// Prueba rápida: npx tsx scripts/test-carga-diaria.ts
import assert from "node:assert/strict";
import { ultimoDiaHabil, estadoCarga, estadoCargaSemanal } from "../src/lib/carga-diaria";

// 2026-10-23 es viernes, 24 sábado, 25 domingo, 26 lunes
assert.equal(ultimoDiaHabil("2026-10-23"), "2026-10-23");
assert.equal(ultimoDiaHabil("2026-10-24"), "2026-10-23");
assert.equal(ultimoDiaHabil("2026-10-25"), "2026-10-23");
assert.equal(ultimoDiaHabil("2026-10-26"), "2026-10-26");

// Domingo: lo del viernes está al día
assert.deepEqual(estadoCarga("2026-10-23", "2026-10-25"), { estado: "al_dia", dias: 2 });
assert.deepEqual(estadoCarga("2026-10-25T15:57:35+00:00", "2026-10-25"), { estado: "al_dia", dias: 0 });
assert.equal(estadoCarga("2026-10-22", "2026-10-25").estado, "atrasada");
// Lunes: lo del viernes ya no alcanza, lo del lunes sí
assert.equal(estadoCarga("2026-10-23", "2026-10-26").estado, "atrasada");
assert.equal(estadoCarga("2026-10-26", "2026-10-26").estado, "al_dia");
// Sin datos
assert.deepEqual(estadoCarga(null, "2026-10-26"), { estado: "sin_datos", dias: null });
assert.deepEqual(estadoCarga("", "2026-10-26"), { estado: "sin_datos", dias: null });

// Semanal: al día hasta 7 días de antigüedad
assert.deepEqual(estadoCargaSemanal("2026-10-19", "2026-10-26"), { estado: "al_dia", dias: 7 });
assert.deepEqual(estadoCargaSemanal("2026-10-18", "2026-10-26"), { estado: "atrasada", dias: 8 });
assert.equal(estadoCargaSemanal("2026-10-15", "2026-10-25").estado, "atrasada");
assert.equal(estadoCargaSemanal("2026-10-23", "2026-10-25").estado, "al_dia");
assert.equal(estadoCargaSemanal(null, "2026-10-25").estado, "sin_datos");
assert.equal(estadoCargaSemanal("2026-10-10", "2026-10-25", 30).estado, "al_dia");

console.log("test-carga-diaria OK");
