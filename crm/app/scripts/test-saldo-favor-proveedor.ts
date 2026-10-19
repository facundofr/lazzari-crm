import assert from "node:assert/strict";
import { fuentesSaldoFavor, repartirSaldoFavor, totalSaldoFavor, listaOPs } from "../src/lib/saldo-favor-proveedor";

// Caso De Pascale (Lazzari, 19/10): 4 OP sin factura = $ 768.911,14 a favor.
const ops = [
  { id: "op69", numero: "OP-000069", fecha: "2026-09-28", moneda: "ARS", monto_bruto: "500000.00", estado: "pagada", op_facturas_compra: [] },
  { id: "op67", numero: "OP-000067", fecha: "2026-09-07", moneda: "ARS", monto_bruto: "4477.88", estado: "pagada", op_facturas_compra: [] },
  { id: "op68", numero: "OP-000068", fecha: "2026-09-07", moneda: "ARS", monto_bruto: "96114.71", estado: "pagada", op_facturas_compra: [] },
  { id: "op70", numero: "OP-000070", fecha: "2026-09-29", moneda: "ARS", monto_bruto: "168318.55", estado: "pagada", op_facturas_compra: [] },
  // anulada, con facturas (sin saldo a favor), y US$ pagada en pesos: no cuentan
  { id: "opA", numero: "OP-000080", fecha: "2026-09-01", moneda: "ARS", monto_bruto: 999, estado: "anulada", op_facturas_compra: [] },
  { id: "opF", numero: "OP-000081", fecha: "2026-09-01", moneda: "ARS", monto_bruto: 999, estado: "pagada", op_facturas_compra: [{}] },
  { id: "opU", numero: "OP-000057", fecha: "2026-10-09", moneda: "ARS", moneda_documentos: "USD", monto_bruto: 999, estado: "pagada", op_facturas_compra: [] },
];
const fuentes = fuentesSaldoFavor(ops, []);
assert.deepEqual(fuentes.map((f) => f.numero), ["OP-000067", "OP-000068", "OP-000069", "OP-000070"]);
assert.equal(totalSaldoFavor(fuentes, "ARS"), 768911.14);
assert.equal(totalSaldoFavor(fuentes, "USD"), 0);
assert.equal(listaOPs(fuentes.slice(0, 2)), "OP-000067 y OP-000068");

// OP con facturas pero con saldo a favor (excedente): cuenta solo ese saldo.
const conSF = fuentesSaldoFavor([{ id: "opF", numero: "OP-1", fecha: "2026-09-01", moneda: "ARS", monto_bruto: 999, op_facturas_compra: [{}] }],
  [{ orden_pago_id: "opF", saldo: "0.99", estado: "disponible" }, { orden_pago_id: "opF", saldo: 50, estado: "aplicado" }]);
assert.equal(conSF.length, 1);
assert.equal(conSF[0].disponible, 0.99);

// Factura de $ 300.000: usa primero las más viejas (67, 68) y parte de la 69.
const r1 = repartirSaldoFavor(fuentes, [{ id: "fc1", saldo: 300000, moneda: "ARS" }]);
assert.equal(r1.length, 1);
assert.equal(r1[0].aplicado, 300000);
assert.deepEqual(r1[0].ops, [
  { orden_pago_id: "op67", monto: 4477.88 },
  { orden_pago_id: "op68", monto: 96114.71 },
  { orden_pago_id: "op69", monto: 199407.41 },
]);

// Factura más grande que el saldo a favor: aplica todo lo que hay; el resto queda a pagar.
const r2 = repartirSaldoFavor(fuentes, [{ id: "fc2", saldo: 1000000, moneda: "ARS" }]);
assert.equal(r2[0].aplicado, 768911.14);
assert.equal(r2[0].ops.length, 4);

// Varias facturas: lo que usa la primera no se vuelve a usar en la segunda.
const r3 = repartirSaldoFavor(fuentes, [{ id: "a", saldo: 600000, moneda: "ARS" }, { id: "b", saldo: 600000, moneda: "ARS" }]);
assert.equal(r3[0].aplicado, 600000);
assert.equal(r3[1].aplicado, 168911.14);
assert.deepEqual(r3[1].ops, [{ orden_pago_id: "op69", monto: 592.59 }, { orden_pago_id: "op70", monto: 168318.55 }]);

// Otra moneda: no se aplica nada.
assert.deepEqual(repartirSaldoFavor(fuentes, [{ id: "u", saldo: 100, moneda: "USD" }]), []);

console.log("test-saldo-favor-proveedor OK");
