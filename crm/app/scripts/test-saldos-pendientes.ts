// Prueba rápida: npx tsx scripts/test-saldos-pendientes.ts
import assert from "node:assert/strict";
import { claveSaldo, esSaldoChico, saldoEnPesos, separarSacados, textoVence, tonoVence } from "../src/lib/saldos-pendientes";

const DOLAR = 1534;
// 1. Solo saldos de facturas ya pagadas en parte, menores a $ 20.000.
assert.equal(esSaldoChico({ total: 217273.9, saldo: 4355.48, moneda: "ARS" }, DOLAR), true, "Pergamino FB 16-2: resto de $ 4.355,48");
assert.equal(esSaldoChico({ total: 15000, saldo: 15000, moneda: "ARS" }, DOLAR), false, "una factura chica sin pagar no se esconde");
assert.equal(esSaldoChico({ total: 500000, saldo: 20000, moneda: "ARS" }, DOLAR), false, "$ 20.000 justos ya no");
assert.equal(esSaldoChico({ total: 500000, saldo: 19999.99, moneda: "ARS" }, DOLAR), true);
assert.equal(esSaldoChico({ total: 500000, saldo: 0, moneda: "ARS" }, DOLAR), false, "sin saldo no");
assert.equal(esSaldoChico({ total: 8000, saldo: 10, moneda: "USD" }, DOLAR), true, "US$ 10 = $ 15.340");
assert.equal(esSaldoChico({ total: 8000, saldo: 20, moneda: "USD" }, DOLAR), false, "US$ 20 = $ 30.680");
assert.equal(esSaldoChico({ total: 8000, saldo: 10, moneda: "USD" }, null), false, "sin dólar del día no se ofrece");
assert.equal(saldoEnPesos({ saldo: 10, moneda: "USD" }, DOLAR), 15340);

// 2. Separar: las sacadas no son pendientes (venta y compra con el mismo id no se confunden).
const filas = [{ lado: "venta" as const, id: "a" }, { lado: "compra" as const, id: "a" }, { lado: "venta" as const, id: "b" }];
const r = separarSacados(filas, new Set([claveSaldo({ lado: "venta", id: "a" })]));
assert.deepEqual(r.pendientes.map(claveSaldo), ["compra:a", "venta:b"]);
assert.deepEqual(r.sacados.map(claveSaldo), ["venta:a"]);

// 3. Colores: vencida, por vencer (de hoy a 7 días) y sin color.
assert.equal(tonoVence(-3), "vencida");
assert.equal(tonoVence(0), "por_vencer");
assert.equal(tonoVence(7), "por_vencer");
assert.equal(tonoVence(8), null);
assert.equal(tonoVence(-3, false), null, "sin saldo no hay color");
assert.equal(textoVence(-12), "vencida hace 12 d");
assert.equal(textoVence(0), "vence hoy");
assert.equal(textoVence(3), "vence en 3 d");
assert.equal(textoVence(20), "en 20 d");

console.log("test-saldos-pendientes OK");
