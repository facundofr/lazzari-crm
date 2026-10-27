import assert from "node:assert/strict";
import { armarRecibos, textoTotalRecibo } from "../src/lib/recibos";

const recibos = armarRecibos({
  recibos: [
    { id: "r1", numero: 1000, fecha: "2026-08-22", cliente_id: "todd" },
    { id: "r2", numero: 1001, fecha: "2026-08-27", cliente_id: "thiago" },
    { id: "r3", numero: 1002, fecha: "2026-09-01", cliente_id: "x" },
  ],
  vinculos: [
    { recibo_id: "r1", movimiento_id: "m1" }, { recibo_id: "r1", movimiento_id: "m2" }, { recibo_id: "r1", movimiento_id: "m3" },
    { recibo_id: "r2", movimiento_id: "m4" },
    { recibo_id: "r3", movimiento_id: "m5" }, { recibo_id: "r3", movimiento_id: "m6" },
  ],
  movimientos: [
    { id: "m1", tipo: "retencion_iibb", monto: "20857.24", moneda: "ARS", conciliado: false }, // la retención no pasa por el banco
    { id: "m2", tipo: "cheque_recibido", monto: 2145833.33, moneda: "ARS", conciliado: true },
    { id: "m3", tipo: "efectivo", monto: 215599.87, moneda: "ARS", conciliado: true, factura_id: "fB" },
    // anulado entero: se muestra con el monto original
    { id: "m4", tipo: "transferencia", monto: 0, monto_original: 247500, moneda: "ARS", anulado: true },
    // uno anulado y otro no: cuenta solo el vivo; montos en 0 no van
    { id: "m5", tipo: "transferencia", monto: 1000, moneda: "USD", conciliado: false },
    { id: "m6", tipo: "cobro", monto: 500, moneda: "ARS", anulado: true },
  ],
  aplicaciones: [{ movimiento_id: "m2", factura_id: "fA" }, { movimiento_id: "m3", factura_id: "fA" }],
  comprobantes: { fA: "FA 0015-00000012", fB: "FA 0015-00000010" },
  clientes: { todd: "TODD SA" },
});

assert.deepEqual(recibos.map((r) => r.numero), [1002, 1001, 1000]); // del más nuevo al más viejo
const r1 = recibos.find((r) => r.numero === 1000)!;
assert.equal(r1.cliente, "TODD SA");
assert.deepEqual(r1.renglones.map((x) => x.medio), ["Cheque", "Efectivo", "Ret. IIBB"]); // retenciones al final
assert.equal(r1.total.ARS, 2382290.44);
assert.deepEqual(r1.facturas, ["FA 0015-00000010", "FA 0015-00000012"]);
assert.equal(r1.conciliado, true); // cheque y efectivo conciliados; la retención no cuenta
assert.equal(r1.anulado, false);

const r2 = recibos.find((r) => r.numero === 1001)!;
assert.equal(r2.anulado, true);
assert.equal(r2.total.ARS, 247500);
assert.equal(r2.cliente, "Cliente sin nombre");

const r3 = recibos.find((r) => r.numero === 1002)!;
assert.equal(r3.anulado, false);
assert.deepEqual(r3.total, { ARS: 0, USD: 1000 });
assert.equal(r3.conciliado, false);
assert.equal(textoTotalRecibo(r3.total, (v, m) => `${m} ${v}`), "USD 1000");

// Columna "Banco" (26/10/2026): las transferencias no se cruzan → "registrado", no "pendiente" para siempre
assert.equal(r1.banco, "conciliado");
assert.equal(r3.banco, "registrado", "solo falta una transferencia");
const [r4] = armarRecibos({
  recibos: [{ id: "r4", numero: 1003, fecha: "2026-10-26", cliente_id: null }],
  vinculos: [{ recibo_id: "r4", movimiento_id: "t" }, { recibo_id: "r4", movimiento_id: "c" }],
  movimientos: [
    { id: "t", tipo: "transferencia", monto: 100, moneda: "ARS", conciliado: false },
    { id: "c", tipo: "cheque_recibido", monto: 200, moneda: "ARS", conciliado: false },
  ],
});
assert.equal(r4.banco, "pendiente", "falta un cheque: sigue pendiente");

// Arreglo 20 (27/10/2026): N° de los cheques de cada recibo (también si el cobro se anuló, ej. cheque rechazado), para buscarlo
assert.deepEqual(r1.cheques, [], "sin la lista de cheques: vacío");
const conCheques = armarRecibos({
  recibos: [{ id: "a", numero: 1061, fecha: "2026-10-24", cliente_id: null }, { id: "b", numero: 1037, fecha: "2026-10-01", cliente_id: null }],
  vinculos: [{ recibo_id: "a", movimiento_id: "c1" }, { recibo_id: "a", movimiento_id: "c2" }, { recibo_id: "a", movimiento_id: "ret" }, { recibo_id: "b", movimiento_id: "c3" }],
  movimientos: [
    { id: "c1", tipo: "cheque_recibido", monto: 1038632.84, moneda: "ARS" },
    { id: "c2", tipo: "cheque_recibido", monto: 1038632.85, moneda: "ARS" },
    { id: "ret", tipo: "retencion_iibb", monto: 100, moneda: "ARS" },
    { id: "c3", tipo: "cheque_recibido", monto: 0, monto_original: 9220848.56, moneda: "ARS", anulado: true },
  ],
  cheques: [
    { numero: "11423615", movimiento_id: "c1" }, { numero: "11423614", movimiento_id: "c2" },
    { numero: "00000176", movimiento_id: "c3" }, { numero: "999", movimiento_id: "otro" }, { numero: "888", movimiento_id: null },
  ],
});
assert.deepEqual(conCheques.find((r) => r.numero === 1061)!.cheques, ["11423615", "11423614"]);
assert.deepEqual(conCheques.find((r) => r.numero === 1037)!.cheques, ["00000176"], "cobro anulado: el cheque sigue figurando");

console.log("test-recibos OK");
