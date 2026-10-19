// npx tsx scripts/test-resumen-cuenta.ts
// Resumen de cuenta corriente (Finanzas Lazza): todos los movimientos con saldo acumulado, mismas reglas que la ficha.
import assert from "node:assert/strict";
import { resumenCliente, resumenProveedor, diferenciaResumen } from "../src/lib/resumen-cuenta";
import { sentidoAjuste } from "../src/lib/tipos-movimiento";

// ── Cliente tipo Del Sol: cobro aplicado, factura anulada pagada (sobrante sin aplicar), NC que la anula,
//    cobro del sistema anterior, ajuste anulado y una factura pendiente.
{
  const facturas = [
    { id: "f1", tipo: "FA", punto_venta: 15, numero: 21, fecha: "2026-09-15", total: 1000, total_acreditado: 0, moneda: "ARS", estado: "pagada" },
    { id: "f2", tipo: "FA", punto_venta: 15, numero: 39, fecha: "2026-09-25", total: 300, total_acreditado: 300, moneda: "ARS", estado: "anulada" },
    { id: "nc", tipo: "NCA", punto_venta: 15, numero: 5, fecha: "2026-09-28", total: 300, saldo_a_favor_cliente: 0, factura_origen_id: "f2", moneda: "ARS", estado: "emitida" },
    { id: "f3", tipo: "FA", punto_venta: 15, numero: 65, fecha: "2026-10-13", total: 500, total_acreditado: 0, moneda: "ARS", estado: "emitida" },
  ];
  const movimientos = [
    { id: "m1", tipo: "cheque_recibido", monto: 1250, fecha: "2026-10-09", moneda: "ARS" },                 // 950 + ret 50 aplicados, 300 de la anulada
    { id: "m2", tipo: "retencion_ganancias", monto: 50, fecha: "2026-10-09", moneda: "ARS" },
    { id: "m3", tipo: "cheque_recibido", monto: 9999, fecha: "2026-09-04", moneda: "ARS", descripcion: "Cobro — FC 405 (sistema anterior) [delsol-19/10]" },
    { id: "m4", tipo: "ajuste", monto: 300, fecha: "2026-10-09", moneda: "ARS", ajuste_sentido: "credito", anulado: true, monto_original: 300 },
  ];
  const aplicaciones = [{ movimiento_id: "m1", factura_id: "f1", monto: 950 }, { movimiento_id: "m2", factura_id: "f1", monto: 50 }];
  const r = resumenCliente(facturas, movimientos as any, aplicaciones);
  assert.equal(r.saldo.ARS, 500, "solo debe la FA 15-65");
  assert.equal(r.renglones.length, 8);
  const anterior = r.renglones.find((x) => x.id === "m3")!;
  assert.equal(anterior.suma, false);
  assert.match(anterior.nota!, /sist\. anterior/);
  assert.equal(anterior.detalle.includes("[delsol"), false, "saca la marca interna");
  const cheque = r.renglones.find((x) => x.id === "m1")!;
  assert.equal(cheque.haber, 950);
  assert.match(cheque.nota!, /\$ 300,00 sin aplicar/);
  assert.equal(r.renglones.find((x) => x.id === "nc")!.suma, false, "la NC que anula una factura anulada no suma");
  assert.equal(r.renglones.find((x) => x.id === "m4")!.anulado, true);
  assert.deepEqual(r.renglones.map((x) => x.fecha), [...r.renglones.map((x) => x.fecha)].sort(), "de la más vieja a la más nueva");
  assert.equal(r.renglones.at(-1)!.saldo, 500);
  assert.deepEqual(diferenciaResumen(r, { ARS: 500, USD: 0 }), { ARS: 0, USD: 0 });
}

// ── Cliente: cobro de más sobre una factura (lo de más no suma) y factura en US$ cobrada por aplicación.
{
  const facturas = [
    { id: "f1", tipo: "FA", fecha: "2026-09-01", total: 100, moneda: "ARS", estado: "pagada" },
    { id: "u1", tipo: "FA", fecha: "2026-09-02", total: 10, moneda: "USD", estado: "emitida" },
  ];
  const movimientos = [
    { id: "m1", tipo: "transferencia", monto: 120, fecha: "2026-09-05", moneda: "ARS", factura_id: "f1" },
    { id: "fx", tipo: "transferencia", monto: 15000, fecha: "2026-09-06", moneda: "ARS" },
  ];
  const r = resumenCliente(facturas, movimientos as any, [{ movimiento_id: "fx", factura_id: "u1", monto: 4 }]);
  assert.equal(r.saldo.ARS, 0);
  assert.equal(r.saldo.USD, 6);
  assert.match(r.renglones.find((x) => x.id === "m1")!.nota!, /\$ 20,00 de más/);
  const fx = r.renglones.find((x) => x.id === "fx")!;
  assert.equal(fx.moneda, "USD");
  assert.equal(fx.haber, 4);
}

// ── Proveedor tipo De Pascale: 4 OP de anticipo, factura pagada con ese saldo, queda a favor nuestro.
{
  const facturas = [{ id: "fc", numero_factura: "0021-00014606", tipo_comprobante: "FC A", fecha: "2026-09-30", total: 675234.89, moneda: "ARS", estado: "pagada",
    op_facturas_compra: [{ monto: 600592.59, ordenes_pago: { estado: "pagada", numero: "OP-000069" } }, { monto: 74642.30, ordenes_pago: { estado: "pagada", numero: "OP-000070" } }] }];
  const ordenes = [
    { id: "o69", numero: "OP-000069", fecha: "2026-09-28", monto_bruto: 600592.59, moneda: "ARS", estado: "pagada", op_facturas_compra: [{ factura_compra_id: "fc", monto: 600592.59 }] },
    { id: "o70", numero: "OP-000070", fecha: "2026-09-29", monto_bruto: 168318.55, moneda: "ARS", estado: "pagada", op_facturas_compra: [{ factura_compra_id: "fc", monto: 74642.30 }] },
  ];
  const movimientos = [
    { id: "p69", tipo: "pago", monto: 600592.59, fecha: "2026-09-28", moneda: "ARS", orden_pago_id: "o69", descripcion: "OP-000069" },
    { id: "p70", tipo: "pago", monto: 168318.55, fecha: "2026-09-29", moneda: "ARS", orden_pago_id: "o70", descripcion: "OP-000070" },
  ];
  const r = resumenProveedor(facturas, ordenes, movimientos as any, sentidoAjuste);
  assert.equal(r.saldo.ARS, -93676.25, "a favor nuestro");
  assert.equal(r.renglones.length, 3, "los movimientos de la OP no se repiten");
  assert.match(r.renglones.find((x) => x.id === "fc")!.nota!, /OP-000069, OP-000070/);
}

// ── Proveedor: OP en pesos que paga facturas en US$ (cuenta lo aplicado en US$), NC en US$,
//    factura "pagada" sin pago cargado (no suma) y OP con $ 0,99 de más que quedó a favor.
{
  const facturas = [
    { id: "fc", numero_factura: "42-1199", tipo_comprobante: "FC A", fecha: "2026-09-16", total: 1112.58, total_acreditado: 158.5, moneda: "USD", estado: "pagada", op_facturas_compra: [{ monto: 954.08, ordenes_pago: { estado: "pagada", numero: "OP-000057" } }] },
    { id: "nc", numero_factura: "42-4674", tipo_comprobante: "NC A", fecha: "2026-10-07", total: 158.5, moneda: "USD", estado: "recibida" },
    { id: "vieja", numero_factura: "1-1", tipo_comprobante: "FC A", fecha: "2026-08-01", total: 5000, moneda: "ARS", estado: "pagada" },
    { id: "f53", numero_factura: "32-1497", tipo_comprobante: "FC A", fecha: "2026-09-30", total: 100, moneda: "ARS", estado: "pagada", op_facturas_compra: [{ monto: 100, ordenes_pago: { estado: "pagada", numero: "OP-000053" } }] },
  ];
  const ordenes = [
    { id: "o57", numero: "OP-000057", fecha: "2026-10-13", monto_bruto: 1447300, moneda: "ARS", estado: "pagada", op_facturas_compra: [{ factura_compra_id: "fc", monto: 954.08 }] },
    { id: "o53", numero: "OP-000053", fecha: "2026-10-13", monto_bruto: 100, moneda: "ARS", estado: "pagada", op_facturas_compra: [{ factura_compra_id: "f53", monto: 100 }] },
  ];
  const movimientos = [
    { id: "a", tipo: "pago", monto: 158.5, fecha: "2026-10-07", moneda: "USD", factura_compra_id: "fc", nota_credito_compra_id: "nc" },
    { id: "p53", tipo: "pago", monto: 100.99, fecha: "2026-10-13", moneda: "ARS", orden_pago_id: "o53" },
  ];
  const r = resumenProveedor(facturas, ordenes, movimientos as any, sentidoAjuste, [{ orden_pago_id: "o53", monto_original: 0.99 }]);
  assert.equal(r.saldo.USD, 0);
  assert.equal(r.saldo.ARS, -0.99);
  assert.equal(r.renglones.find((x) => x.id === "o57")!.moneda, "USD");
  assert.equal(r.renglones.find((x) => x.id === "vieja")!.suma, false);
  assert.match(r.renglones.find((x) => x.id === "o53")!.nota!, /0,99 de más/);
}

console.log("test-resumen-cuenta OK");
