// Condición de pago leída de la factura (casos reales 16/10). Uso: npx tsx scripts/test-condicion-desde-factura.ts
import assert from "node:assert/strict";
import { condicionDeCarga, condicionDesdeFactura, pagoDeFactura, textoPagoCarga } from "../src/lib/condicion-pago";
assert.deepEqual(condicionDesdeFactura("Cond. Vta.: 10 DIAS FECHA FACTURA CONTRA ENTREGA - Cuenta Corriente", "2026-10-16", "2026-10-26"), { condicion_pago: "cuenta_corriente", dias_pago: 10 });
assert.deepEqual(condicionDesdeFactura("Condiciones de venta: Cuenta Corriente. Fec. de Venc. Pago: 15/10/2026", "2026-10-15", "2026-10-15"), { condicion_pago: "contra_entrega", dias_pago: 0 });
assert.deepEqual(condicionDesdeFactura("Cuenta corriente", "2026-10-01", "2026-10-31"), { condicion_pago: "cuenta_corriente", dias_pago: 30 });
assert.deepEqual(condicionDesdeFactura("CONTADO"), { condicion_pago: "contra_entrega", dias_pago: 0 });
assert.equal(condicionDesdeFactura("Remito 0001-35113"), null);
assert.equal(condicionDesdeFactura(""), null);

// Forma de pago elegida en Compras Lazza › Cargar factura (P04, 02/11): se guarda en condicion_pago / dias_pago y la OP la lee.
assert.equal(textoPagoCarga("echeq", "60"), "Pago: eCheq a 60 días");
assert.equal(textoPagoCarga("transferencia", ""), "Pago: transferencia");
assert.deepEqual(condicionDeCarga("60"), { condicion_pago: "cuenta_corriente", dias_pago: 60 });
assert.deepEqual(condicionDeCarga("0"), { condicion_pago: "contra_entrega", dias_pago: 0 });
assert.equal(condicionDeCarga(""), null);
// "eCheq a 60 días" → echeq, 60 (factura vieja: solo en las notas)
let p = pagoDeFactura({ notas: "Pago: eCheq a 60 días\nCargada con «Compras Lazza»" });
assert.equal(p.medio, "echeq"); assert.equal(p.dias, 60); assert.equal(p.texto, "Pago: eCheq a 60 días");
// Factura nueva: los días salen de la columna; la nota para Finanzas se muestra
p = pagoDeFactura({ condicion_pago: "cuenta_corriente", dias_pago: 45, notas: "Pago: eCheq a 45 días\nNota para Finanzas: pagar junto con la 0003-123\nCargada con «Compras Lazza»" });
assert.deepEqual(p, { medio: "echeq", dias: 45, nota: "pagar junto con la 0003-123", texto: "Pago: eCheq a 45 días · Nota: pagar junto con la 0003-123" });
p = pagoDeFactura({ notas: "Pago: transferencia\nCargada con «Compras Lazza»" });
assert.equal(p.medio, "transferencia"); assert.equal(p.dias, null); assert.equal(p.texto, "Pago: transferencia");
// Cargada por otro lado (sin línea Pago:) con condición: se muestra igual
assert.equal(pagoDeFactura({ condicion_pago: "contra_entrega", dias_pago: 0, notas: "Condición de venta: CONTADO" }).texto, "Pago: contra entrega");
assert.equal(pagoDeFactura({ notas: "Remito 0001-35113" }).texto, "");
assert.equal(pagoDeFactura(null).medio, null);
console.log("OK: condición de pago desde la factura y desde Cargar factura");
