import assert from "node:assert/strict";
import { monedaCostoSospechosa, costoRaro } from "../src/lib/presupuesto-moneda-costo";

// Caso PR-2026-1142: PR en $, costo 36.425 cargado en US$, venta 49.173,75, sin dólar en el PR (referencia 1.500).
const pr1142 = monedaCostoSospechosa(36425, "USD", 49173.75, "ARS", 0, 0, 1500);
assert.ok(pr1142);
assert.equal(pr1142!.sugerida, "ARS");
assert.equal(pr1142!.costoActual, 36425 * 1500);
assert.equal(pr1142!.costoSugerido, 36425);

// Ya corregido (costo en $): nada que avisar.
assert.equal(monedaCostoSospechosa(36425, "ARS", 49173.75, "ARS", 0, 0, 1500), null);

// Al revés: costo US$ 20 cargado como $ en un PR en $ con venta $ 40.000 (dólar 1.500 → $ 30.000) → sugiere US$.
const alReves = monedaCostoSospechosa(20, "ARS", 40000, "ARS", 1500, 0);
assert.equal(alReves?.sugerida, "USD");

// PR en US$: costo $ 30.000 cargado como US$, venta US$ 25 → sugiere $.
assert.equal(monedaCostoSospechosa(30000, "USD", 25, "USD", 1500, 0)?.sugerida, "ARS");

// Divisa: usa el dólar divisa del PR.
assert.equal(monedaCostoSospechosa(36425, "USD Divisa", 49173.75, "ARS", 1500, 1550)?.costoActual, 36425 * 1550);

// Margen raro pero ninguna moneda da normal: no adivina (venta a pérdida en $, por ejemplo).
assert.equal(monedaCostoSospechosa(100000, "ARS", 40000, "ARS", 1500, 0), null);

// Normal: no avisa. Sin dólar ni referencia, sin costo o sin venta: no avisa.
assert.equal(monedaCostoSospechosa(800, "ARS", 1000, "ARS", 1500, 0), null);
assert.equal(monedaCostoSospechosa(36425, "USD", 49173.75, "ARS", 0, 0, 0), null);
assert.equal(monedaCostoSospechosa(0, "USD", 1000, "ARS", 1500, 0), null);
assert.equal(monedaCostoSospechosa(100, "USD", 0, "ARS", 1500, 0), null);

assert.equal(costoRaro(2001, 1000), true);
assert.equal(costoRaro(99, 1000), true);
assert.equal(costoRaro(800, 1000), false);
assert.equal(costoRaro(0, 1000), false);

console.log("test-presupuesto-moneda-costo OK");
