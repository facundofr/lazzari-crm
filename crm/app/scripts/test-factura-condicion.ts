import assert from "node:assert/strict";
import {
  calcFechaVencimiento, condicionVentaCliente, puntosVentaSociedad, tipoFacturaPorCondicionIva,
  precioNetoItemPresupuesto, convertirItemsEntreAyB, convertirPrecioMoneda,
} from "../src/lib/factura-condicion";

assert.equal(calcFechaVencimiento("Contado", "2026-10-12"), "2026-10-12");
assert.equal(calcFechaVencimiento("30 días", "2026-10-12"), "2026-11-11");
assert.equal(calcFechaVencimiento("45 días", "2026-10-12"), "2026-11-26");
assert.equal(calcFechaVencimiento("Cheque 60 días", "2026-10-12"), "2026-12-11");
assert.equal(calcFechaVencimiento("Cta. Cte.", "2026-10-12"), "2026-11-11");
assert.equal(calcFechaVencimiento("Cta. Cte.", "2026-10-12", 20), "2026-11-01");
assert.equal(calcFechaVencimiento("raro", "2026-10-12"), "");
assert.equal(calcFechaVencimiento("30 días", ""), "");

assert.equal(condicionVentaCliente(0, null), "Contado");
assert.equal(condicionVentaCliente(30, "Transferencia"), "30 días");
assert.equal(condicionVentaCliente(45, null), "45 días");
assert.equal(condicionVentaCliente(60, "Cheque"), "Cheque 60 días");
assert.equal(condicionVentaCliente(45, "cheque diferido"), "45 días");
assert.equal(condicionVentaCliente(20, null), "Cta. Cte.");

assert.deepEqual(puntosVentaSociedad("Grupo LA"), [10]);
assert.deepEqual(puntosVentaSociedad("Lazzari"), [15, 16]);
assert.equal(tipoFacturaPorCondicionIva("RI"), "FA");
assert.equal(tipoFacturaPorCondicionIva("Monotributo"), "FA");
assert.equal(tipoFacturaPorCondicionIva("CF"), "FB");
assert.equal(tipoFacturaPorCondicionIva(null), "FB");

assert.equal(precioNetoItemPresupuesto({ cantidad: 2, precio_venta: 100, iva_porcentaje: 21, total: 999 }), 100);
assert.equal(precioNetoItemPresupuesto({ cantidad: 2, precio_venta: null, iva_porcentaje: 21, total: 242 }), 100);
assert.equal(precioNetoItemPresupuesto({ cantidad: 1, precio_venta: null, iva_porcentaje: 21, total: null }), 0);

const items = [{ precio_unitario: 100, iva_porcentaje: 21 }];
assert.equal(convertirItemsEntreAyB(items, true, false)[0].precio_unitario, 121);
assert.equal(convertirItemsEntreAyB([{ precio_unitario: 121, iva_porcentaje: 21 }], false, true)[0].precio_unitario, 100);
assert.equal(convertirItemsEntreAyB(items, true, true), items);

assert.equal(convertirPrecioMoneda(10, "USD", "ARS", 1450), 14500);
assert.equal(convertirPrecioMoneda(14500, "ARS", "USD", 1450), 10);
assert.equal(convertirPrecioMoneda(10, "USD", "USD", 1450), 10);
assert.equal(convertirPrecioMoneda(10, "USD", "ARS", 0), 10);

console.log("test-factura-condicion OK");
