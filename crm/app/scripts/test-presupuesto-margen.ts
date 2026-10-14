import assert from "node:assert/strict";
import { margenPR, gastosPorcentajePR } from "../src/lib/presupuesto-margen";

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

// Sin costos cargados: no se inventa un margen
const sinCosto = margenPR({ moneda: "ARS", modalidadEmision: "electronica", items: [{ cantidad: 1, precioVenta: 500, precioCosto: 0 }] });
assert.equal(sinCosto.margenPct, null);

// Sin renglones: no rompe
assert.equal(margenPR({ moneda: "ARS", items: [] }).margenPct, null);

console.log("OK: ganancia y margen del PR (7 % ARCA, 2 % manual, costos en US$, sin costos).");
