import assert from "node:assert/strict";
import { avisosDePaso, facturasDeOrdenPago, numerosDeOrdenPago, type FilaFacturaOP } from "../src/lib/cobro-orden-pago";

const fila = (x: Partial<FilaFacturaOP> & { id: string }): FilaFacturaOP => ({ tipo: "FA", punto_venta: 15, numero: 11, fecha: "2026-09-07", estado: "pendiente", moneda: "ARS", subtotal: 1000, iva: 210, total: 1210, total_acreditado: 0, ...x });
const op = (...f: Array<{ tipo?: string; punto_venta?: number; numero?: number; comprobante?: string }>) => ({ facturas_pagadas: f });

// Números a buscar: sin NC, sin repetir
assert.deepEqual(numerosDeOrdenPago(op({ tipo: "FA", punto_venta: 15, numero: 11 }, { tipo: "FA", punto_venta: 15, numero: 14 }, { tipo: "NCA", punto_venta: 15, numero: 3 }, { tipo: "FA", punto_venta: 15, numero: 11 })), [11, 14]);

// Pesos y dólares separados; la cobrada y la que no está se avisan
{
  const r = facturasDeOrdenPago(
    op({ tipo: "FA", punto_venta: 15, numero: 11 }, { tipo: "FA", punto_venta: 16, numero: 8 }, { tipo: "FA", punto_venta: 15, numero: 14 }, { tipo: "FA", punto_venta: 15, numero: 99 }),
    [
      fila({ id: "a", numero: 11 }),
      fila({ id: "b", punto_venta: 16, numero: 8, moneda: "USD", total: 500, subtotal: 413.22, tipo_cambio: 1500 }),
      fila({ id: "c", numero: 14 }), // ya cobrada
    ],
    { c: 1210 },
  );
  assert.equal(r.sinDetalle, false);
  assert.deepEqual(r.ars.map((f) => [f.id, f.numero, f.saldo]), [["a", "FA 0015-00000011", 1210]]);
  assert.deepEqual(r.usd.map((f) => [f.id, f.numero, f.saldo, f.cotizacion]), [["b", "FA 0016-00000008", 500, 1500]]);
  assert.equal(r.avisos.length, 2);
  assert.ok(r.avisos.some((a) => a.includes("FA 0015-00000014") && a.includes("ya figura cobrada")));
  assert.ok(r.avisos.some((a) => a.includes("15-99") && a.includes("no está en el sistema")));
}

// Cobro parcial anterior: el saldo es lo que falta
assert.equal(facturasDeOrdenPago(op({ punto_venta: 15, numero: 11 }), [fila({ id: "a" })], { a: 200 }).ars[0].saldo, 1010);

// Una NC con el mismo número no se toma; una anulada tampoco
{
  const r = facturasDeOrdenPago(op({ punto_venta: 15, numero: 11 }), [fila({ id: "nc", tipo: "NCA" }), fila({ id: "x", estado: "anulada" })], {});
  assert.equal(r.ars.length + r.usd.length, 0);
  assert.equal(r.avisos.length, 1);
}

// Dos facturas con el mismo número: elige la letra que dice la OP
{
  const r = facturasDeOrdenPago(op({ tipo: "FB", punto_venta: 15, numero: 11 }), [fila({ id: "fa", tipo: "FA" }), fila({ id: "fb", tipo: "FB" })], {});
  assert.deepEqual(r.ars.map((f) => f.id), ["fb"]);
}

// La OP nombra dos veces la misma factura: se cobra una sola
assert.equal(facturasDeOrdenPago(op({ punto_venta: 15, numero: 11 }, { punto_venta: 15, numero: 11 }), [fila({ id: "a" })], {}).ars.length, 1);

// OP sin detalle de facturas
assert.equal(facturasDeOrdenPago({ facturas_pagadas: [] }, [], {}).sinDetalle, true);
assert.equal(facturasDeOrdenPago({}, [], {}).sinDetalle, true);

// Avisos del paso a paso
assert.deepEqual(avisosDePaso({ ars: [{} as never], usd: [{} as never], avisos: ["x"] }, "ars"), ["Paso 1 de 2: facturas en pesos. Al confirmar se abre el cobro de las facturas en dólares.", "x"]);
assert.deepEqual(avisosDePaso({ ars: [{} as never], usd: [{} as never], avisos: [] }, "usd"), ["Paso 2 de 2: facturas en dólares."]);
assert.deepEqual(avisosDePaso({ ars: [{} as never], usd: [], avisos: ["y"] }, "ars"), ["y"], "con un solo paso no hay «paso»");

console.log("test-cobro-orden-pago OK");
