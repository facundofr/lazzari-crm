// npx tsx scripts/test-saldo-clientes.ts
// B3: saldo real de cuenta corriente de clientes (ARS y USD por separado).
import assert from "node:assert/strict";
import { calcularSaldosClientes, cobradoPorFactura, saldoFacturaVenta, saldoClienteEn, superaLimiteCredito } from "../src/lib/saldo-clientes";

const facturas = [
  // Cliente A, ARS
  { id: "f1", cliente_id: "A", tipo: "FA", total: 1000, total_acreditado: 0, moneda: "ARS", estado: "emitida" },
  { id: "f2", cliente_id: "A", tipo: "FB", total: 500, total_acreditado: 200, moneda: "ARS", estado: "parcial" },
  { id: "nc2", cliente_id: "A", tipo: "NCB", total: 200, saldo_a_favor_cliente: 0, factura_origen_id: "f2", moneda: "ARS", estado: "emitida" },
  { id: "f3", cliente_id: "A", tipo: "FA", total: 999, moneda: "ARS", estado: "anulada" },
  // Cliente A, USD
  { id: "u1", cliente_id: "A", tipo: "FA", total: 100, moneda: "USD", estado: "parcial" },
  // Cliente B: NC que superó el saldo (quedó a favor) y NC suelta
  { id: "f4", cliente_id: "B", tipo: "FA", total: 300, total_acreditado: 300, moneda: "ARS", estado: "pagada" },
  { id: "nc4", cliente_id: "B", tipo: "NCA", total: 400, saldo_a_favor_cliente: 100, factura_origen_id: "f4", moneda: "ARS", estado: "emitida" },
  { id: "nc5", cliente_id: "B", tipo: "NCA", total: 50, factura_origen_id: null, moneda: "ARS", estado: "emitida" },
];
const movimientos = [
  { id: "m1", factura_id: "f1", monto: 600, moneda: "ARS" },                 // cobro
  { id: "m2", factura_id: "f1", monto: 50, moneda: "ARS" },                  // retención sufrida
  { id: "m3", factura_id: "f1", monto: 1000, moneda: "ARS", anulado: true }, // anulado: no cuenta
  { id: "m4", factura_id: "f2", monto: 100, moneda: "ARS" },                 // cobro consolidado (también en aplicaciones)
  { id: "m5", factura_id: "u1", monto: 5000, moneda: "ARS" },                // pesos sobre factura USD: no se mezcla
];
const aplicaciones = [
  { movimiento_id: "m4", factura_id: "f2", monto: 100, movimientos: { anulado: false } },
  { movimiento_id: "fx1", factura_id: "u1", monto: 40, movimientos: [{ anulado: false }] }, // liquidación USD
  { movimiento_id: "fx2", factura_id: "u1", monto: 60, movimientos: { anulado: true } },    // anulada
];

const cobrado = cobradoPorFactura(facturas, movimientos, aplicaciones);
assert.equal(cobrado.f1, 650, "cobro + retención, sin el anulado");
assert.equal(cobrado.f2, 100, "el movimiento con aplicación no se cuenta dos veces");
assert.equal(cobrado.u1, 40, "solo la aplicación USD vigente");

assert.equal(saldoFacturaVenta(facturas[0], cobrado.f1), 350);
assert.equal(saldoFacturaVenta(facturas[1], cobrado.f2), 200);
assert.equal(saldoFacturaVenta(facturas[3], 0), 0, "anulada no debe");
assert.equal(saldoFacturaVenta(facturas[2], 0), 0, "NC no debe");
assert.equal(saldoFacturaVenta({ ...facturas[0] }, 5000), 0, "nunca negativo");

const s = calcularSaldosClientes(facturas, movimientos, aplicaciones);
assert.deepEqual(s.A.ARS, { deuda: 550, aFavor: 0, saldo: 550 });
assert.deepEqual(s.A.USD, { deuda: 60, aFavor: 0, saldo: 60 });
assert.deepEqual(s.B.ARS, { deuda: 0, aFavor: 150, saldo: -150 }, "NC a favor (100) + NC suelta (50)");

assert.equal(saldoClienteEn(s, "A", "ARS"), 550);
assert.equal(saldoClienteEn(s, "A", "USD"), 60);
assert.equal(saldoClienteEn(s, "Z", "ARS"), 0);
assert.equal(saldoClienteEn(null, "A"), 0);

// Límite de crédito: solo aviso (devuelve true/false, nunca frena).
assert.equal(superaLimiteCredito(500, s.A), true);
assert.equal(superaLimiteCredito(600, s.A), false);
assert.equal(superaLimiteCredito(600, s.A, 1000), true, "USD convertidos con la cotización");
assert.equal(superaLimiteCredito(0, s.A), false, "sin límite no avisa");
assert.equal(superaLimiteCredito(100, s.B), false, "saldo a favor no avisa");

console.log("test-saldo-clientes OK");
