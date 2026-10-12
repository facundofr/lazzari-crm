// Prueba de src/lib/resumen-economico.ts — correr con: npx tsx scripts/test-resumen-economico.mjs
import assert from "node:assert/strict";
import { calcularResumen, leerTildados, netoCuentaCorriente, sumarPorMoneda } from "../src/lib/resumen-economico.ts";

const montos = {
  disponible: { ARS: 1000, USD: 10 },
  cartera: { ARS: 500, USD: 0 },
  a_cobrar: { ARS: 2000, USD: 100 },
  vendido_sin_facturar: { ARS: 300, USD: 0 },
  emitidos: { ARS: 1200, USD: 0 },
  a_pagar: { ARS: 800, USD: 50 },
  deudas: { ARS: 400, USD: 0 },
};

// De fábrica: todo menos "vendido sin facturar".
const fabrica = leerTildados(null);
assert.equal(fabrica.has("vendido_sin_facturar"), false);
assert.equal(fabrica.size, 6);
const r = calcularResumen(montos, fabrica, 1500);
assert.deepEqual(r.tengo, { ARS: 3500, USD: 110 });
assert.deepEqual(r.debo, { ARS: 2400, USD: 50 });
assert.deepEqual(r.neto, { ARS: 1100, USD: 60 });
assert.equal(r.netoEnPesos, 1100 + 60 * 1500);

// Destildar deudas y tildar vendido sin facturar.
const t = leerTildados("disponible,cartera,a_cobrar,vendido_sin_facturar,emitidos,a_pagar,cualquiera");
assert.equal(t.has("deudas"), false);
assert.deepEqual(calcularResumen(montos, t, null).neto, { ARS: 1800, USD: 60 });
assert.equal(calcularResumen(montos, t, null).netoEnPesos, null);
// Nada tildado (guardado vacío): todo en cero.
assert.deepEqual(calcularResumen(montos, leerTildados(""), 1).neto, { ARS: 0, USD: 0 });

// Cuenta corriente: neto con lo que está a favor de la otra parte ya restado.
const cc = netoCuentaCorriente([{ ARS: 1000, USD: 0 }, { ARS: -200, USD: 5 }, { ARS: 0.1, USD: -1 }]);
assert.deepEqual(cc.neto, { ARS: 800.1, USD: 4 });
assert.deepEqual(cc.aFavor, { ARS: 200, USD: 1 });

assert.deepEqual(sumarPorMoneda([{ m: 10, c: "ARS" }, { m: 5, c: "USD" }, { m: 1.005, c: null }], (f) => f.m, (f) => f.c), { ARS: 11.01, USD: 5 });

console.log("resumen-economico OK");
