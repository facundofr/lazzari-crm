import assert from "node:assert/strict";
import { margenPR, gastosPorcentajePR, margenNetoPct, costoEnMonedaPR } from "../src/lib/presupuesto-margen";

assert.equal(gastosPorcentajePR("manual"), 2);
assert.equal(gastosPorcentajePR("electronica"), 7);
assert.equal(gastosPorcentajePR("sin_definir"), 7);
assert.equal(gastosPorcentajePR(null), 7);

// ARCA 7 %: venta 1.000, costo 800 → neta 930 → ganancia 130, margen 16,25 % → 16,3
const arca = margenPR({ moneda: "ARS", modalidadEmision: "electronica", items: [{ cantidad: 2, precioVenta: 500, precioCosto: 400, costoMoneda: "ARS" }] });
assert.equal(arca.gastosPct, 7);
assert.equal(arca.venta, 1000);
assert.equal(arca.costo, 800);
assert.equal(arca.ganancia, 130);
assert.equal(arca.margenPct, 16.3);

// Manual 2 %: neta 980 → ganancia 180, margen 22,5 %
const manual = margenPR({ moneda: "ARS", modalidadEmision: "manual", items: [{ cantidad: 2, precioVenta: 500, precioCosto: 400 }] });
assert.equal(manual.ganancia, 180);
assert.equal(manual.margenPct, 22.5);

// Costo en US$ billete en un PR en pesos: 100 US$ × 1.500 = 150.000 de costo
const usd = margenPR({ moneda: "ARS", tipoCambio: 1500, tipoCambioDivisas: 1480, modalidadEmision: "electronica", items: [{ cantidad: 1, precioVenta: 200000, precioCosto: 100, costoMoneda: "USD" }] });
assert.equal(usd.costo, 150000);
assert.equal(usd.ganancia, 36000);

// Flete interno: venta 1.000, costo 800 + envío 50 → neta 930 → ganancia 80, margen 80/850 = 9,4 %; no cambia la venta
const conEnvio = margenPR({ moneda: "ARS", modalidadEmision: "electronica", costoEnvioInterno: 50, items: [{ cantidad: 2, precioVenta: 500, precioCosto: 400 }] });
assert.equal(conEnvio.venta, 1000);
assert.equal(conEnvio.costo, 850);
assert.equal(conEnvio.ganancia, 80);
assert.equal(conEnvio.margenPct, 9.4);
assert.equal(margenPR({ moneda: "ARS", modalidadEmision: "electronica", costoEnvioInterno: -5, items: [{ cantidad: 2, precioVenta: 500, precioCosto: 400 }] }).costo, 800);

// Sin costos cargados: no se inventa un margen
const sinCosto = margenPR({ moneda: "ARS", modalidadEmision: "electronica", items: [{ cantidad: 1, precioVenta: 500, precioCosto: 0 }] });
assert.equal(sinCosto.margenPct, null);

// Sin renglones: no rompe
assert.equal(margenPR({ moneda: "ARS", items: [] }).margenPct, null);

// Regla única (H43): margen neto de un renglón
assert.equal(margenNetoPct(120, 100, 7), 11.6);
assert.equal(margenNetoPct(120, 100, 2), 17.6);
assert.equal(margenNetoPct(120, 0, 7), null);
assert.equal(margenNetoPct(0, 100, 7), null);

// Sin dólar no se inventa: costo en US$ en PR en pesos sin TC → null (antes tomaba 100 como si fueran pesos)
assert.equal(costoEnMonedaPR(100, "USD", "ARS", 0, 0), null);
assert.equal(costoEnMonedaPR(100, "USD Divisa", "ARS", 0, 1400), 140000);
assert.equal(costoEnMonedaPR(1000, "ARS", "USD", 0, 0), null);
assert.equal(costoEnMonedaPR(100, "USD", "USD", 0, 0), 100);
assert.equal(costoEnMonedaPR(0, "USD", "ARS", 0, 0), 0);
const sinTc = margenPR({ moneda: "ARS", modalidadEmision: "electronica", items: [
  { cantidad: 1, precioVenta: 1000, precioCosto: 800, costoMoneda: "ARS" },
  { cantidad: 1, precioVenta: 200000, precioCosto: 100, costoMoneda: "USD" },
] });
assert.equal(sinTc.sinDolar, 1);
assert.equal(sinTc.venta, 1000);
assert.equal(sinTc.margenPct, 16.3);

console.log("OK: ganancia y margen del PR (7 % ARCA, 2 % manual, costos en US$, sin costos).");
