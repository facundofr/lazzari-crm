import assert from "node:assert/strict";
import { calcularCobertura } from "../src/lib/cobertura-fijos";

const base = { diaDelMes: 15, diasDelMes: 30 };
const item = (cant: number, venta: number, costo: number) => ({ cantidad: cant, precioVenta: venta, precioCosto: costo, costoMoneda: "ARS" });
const fijos = [
  { monto: 4500000, moneda: "ARS", activo: true },
  { monto: 178200, moneda: "ARS", activo: true },
  { monto: 800, moneda: "USD", activo: true },
  { monto: 999999, moneda: "ARS", activo: false },
];

// PR ARCA (7 %): venta 10.000.000, costo 7.000.000 → neta 9.300.000 → ganancia 2.300.000
const pr1 = { id: "1", moneda: "ARS", modalidadEmision: "electronica", items: [item(1, 10000000, 7000000)] };
// PR sin costo cargado: no entra en la ganancia, se cuenta aparte
const pr2 = { id: "2", moneda: "ARS", modalidadEmision: "electronica", items: [item(1, 1000000, 0)] };
// PR en US$ sin tipo de cambio: se avisa, no se inventa
const pr3 = { id: "3", moneda: "USD", modalidadEmision: "electronica", items: [item(1, 100, 50)] };

const c = calcularCobertura({ ...base, prs: [pr1, pr2, pr3], fijos, dolarFijos: 1500 });
assert.equal(c.ganancia, 2300000);
assert.equal(c.ventaNeta, 10000000);
assert.equal(c.ventaSinCosto, 1000000);
assert.equal(c.prSinCosto, 1);
assert.equal(c.prSinTC, 1);
assert.equal(c.fijosARS, 4678200);
assert.equal(c.fijosUSD, 800);
assert.equal(c.fijosTotal, 4678200 + 800 * 1500); // 5.878.200
assert.equal(c.coberturaPct, 39); // 2.300.000 / 5.878.200
assert.equal(c.faltaGanancia, 5878200 - 2300000);
assert.equal(c.margenSobreVenta, 0.23);
assert.equal(c.faltaVender, Math.round((3578200 / 0.23) * 100) / 100);
assert.equal(c.gananciaProyectada, 4600000); // mitad del mes → el doble

// Sin dólar cargado: los fijos en US$ no se pasan a pesos, se avisa (null)
const sinDolar = calcularCobertura({ ...base, prs: [pr1], fijos, dolarFijos: 0 });
assert.equal(sinDolar.fijosTotal, null);
assert.equal(sinDolar.coberturaPct, null);
assert.equal(sinDolar.faltaVender, null);

// Fijos solo en pesos y ya cubiertos
const cubierto = calcularCobertura({ ...base, prs: [pr1], fijos: [{ monto: 2000000, moneda: "ARS", activo: true }], dolarFijos: 0 });
assert.equal(cubierto.coberturaPct, 115);
assert.equal(cubierto.faltaGanancia, 0);
assert.equal(cubierto.faltaVender, 0);

// Sin ventas todavía: no hay margen, no se inventa
const vacio = calcularCobertura({ ...base, prs: [], fijos: [{ monto: 1000, moneda: "ARS", activo: true }], dolarFijos: 0 });
assert.equal(vacio.margenSobreVenta, null);
assert.equal(vacio.faltaVender, null);
assert.equal(vacio.coberturaPct, 0);
console.log("OK test-cobertura-fijos");
