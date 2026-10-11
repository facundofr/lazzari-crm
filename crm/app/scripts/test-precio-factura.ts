// npx tsx scripts/test-precio-factura.ts
// A1: precio que se manda a /api/facturacion según FA/FB y PR manual/electrónico.
import assert from "node:assert/strict";
import { precioUnitarioParaFactura, esComprobanteA } from "../src/lib/precio-factura";

const p = (tipo: string, sourceIsManual: boolean, precioNeto: number, ivaPorcentaje = 21) =>
  precioUnitarioParaFactura({ tipo, sourceIsManual, precioNeto, ivaPorcentaje });

// PR electrónico (precio neto)
assert.equal(p("FA", false, 1000), 1000, "FA de PR electrónico: neto tal cual");
assert.equal(p("FB", false, 1000), 1210, "FB de PR electrónico: se suma el IVA (el bug A1 mandaba 1000)");
assert.equal(p("FCEA", false, 1000), 1000);
assert.equal(p("FCEB", false, 1000), 1210);
assert.equal(p("FB", false, 1000, 10.5), 1105);
assert.equal(p("FB", false, 1000, 0), 1000);

// PR manual (precio final con IVA)
assert.equal(p("FB", true, 1210), 1210, "FB de PR manual: precio final tal cual");
assert.equal(p("FA", true, 1210), 1000, "FA de PR manual: se saca el IVA");
assert.equal(p("FA", true, 1105, 10.5), 1000);

// Redondeo a centavos
assert.equal(p("FB", false, 33.33), 40.33);
assert.equal(p("FA", true, 100), 82.64);

// IVA inválido → 21 %
assert.equal(p("FB", false, 100, Number.NaN), 121);

assert.equal(esComprobanteA("FA"), true);
assert.equal(esComprobanteA("fcea"), true);
assert.equal(esComprobanteA("FB"), false);
assert.equal(esComprobanteA("X"), false);

// Misma regla que tenía Ventas antes del cambio (isFacturaA = endsWith("A")).
function reglaVieja(tipo: string, manual: boolean, neto: number, iva: number) {
  const r = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
  return tipo.endsWith("A")
    ? manual ? r(neto / (1 + iva / 100)) : r(neto)
    : manual ? r(neto) : r(neto * (1 + iva / 100));
}
for (const tipo of ["FA", "FB"]) for (const manual of [true, false]) for (const neto of [0, 1, 99.99, 1234.56, 100000]) for (const iva of [0, 10.5, 21, 27]) {
  assert.equal(p(tipo, manual, neto, iva), reglaVieja(tipo, manual, neto, iva), `${tipo} manual=${manual} ${neto} ${iva}`);
}

console.log("test-precio-factura OK");
