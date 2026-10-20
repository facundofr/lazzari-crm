// npx tsx scripts/test-resumen-cuenta.ts
// Resumen de cuenta corriente (Finanzas Lazza): todos los movimientos con saldo acumulado, mismas reglas que la ficha.
import assert from "node:assert/strict";
import { resumenCliente, resumenProveedor, diferenciaResumen, detalleCortoCobro } from "../src/lib/resumen-cuenta";
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
  // Factura anulada con NC (Augusto 20/10): la factura suma en Debe y la NC entera en Haber (se cancelan).
  const f2 = r.renglones.find((x) => x.id === "f2")!, nc = r.renglones.find((x) => x.id === "nc")!;
  assert.equal(f2.debe, 300); assert.equal(f2.suma, true); assert.match(f2.nota!, /anulada con NCA 0015-00000005/);
  assert.equal(nc.haber, 300); assert.equal(nc.suma, true); assert.match(nc.nota!, /anula FA 0015-00000039/);
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

// ── Cliente tipo Barraza: cheque rechazado = cobro en Haber + rechazo en Debe (se cancelan), y un cobro
//    posterior bueno sobre la misma factura sigue sumando entero.
{
  const facturas = [{ id: "f10", tipo: "FA", punto_venta: 15, numero: 10, fecha: "2026-09-07", total: 7623000, total_acreditado: 0, moneda: "ARS", estado: "emitida" }];
  const movimientos = [
    { id: "ch74", tipo: "cheque_recibido", monto: 7623000, monto_original: 7623000, fecha: "2026-09-08", moneda: "ARS", anulado: true, anulado_at: "2026-10-06T13:00:00Z",
      descripcion: "[ANULADO · cheque rechazado] BANCO GALICIA — N° 00000074" },
    { id: "ok", tipo: "transferencia", monto: 1000, fecha: "2026-10-10", moneda: "ARS", factura_id: "f10" },
  ];
  const r = resumenCliente(facturas, movimientos as any, []);
  const cobro = r.renglones.find((x) => x.id === "ch74")!;
  const rechazo = r.renglones.find((x) => x.id === "ch74-rechazo")!;
  assert.equal(cobro.detalle, "Cheque Galicia N° 74", "corto y sin la marca [ANULADO ...]");
  assert.equal(cobro.completo, "BANCO GALICIA — N° 00000074");
  assert.equal(cobro.anulado, false, "no se tacha");
  assert.equal(cobro.haber, 7623000);
  assert.equal(rechazo.debe, 7623000);
  assert.equal(rechazo.detalle, "Cheque rechazado N° 74");
  assert.equal(rechazo.fecha, "2026-10-06", "fecha del rechazo");
  assert.equal(r.renglones.find((x) => x.id === "ok")!.haber, 1000);
  assert.equal(r.saldo.ARS, 7622000);
  assert.deepEqual(r.renglones.map((x) => x.id), ["f10", "ch74", "ch74-rechazo", "ok"]);
}

// ── Detalle corto (Augusto 20/10): recibo + cheque con banco, número y vencimiento; si falta el cheque, del texto.
{
  const mv = { id: "c131", tipo: "cheque_recibido", monto: 10110492.35, fecha: "2026-09-18", moneda: "ARS",
    descripcion: "BANCO DE GALICIA Y BUENOS AIRES S.A.U. — N° 00000131 — JESICA PAOLA BARRAZA — BANCO DE GALICIA Y BUENOS AIRES S.A.U. · N° 00000131 · 2026-10-16 · ID: GYKNXL76P8QNMPR" };
  const t = mv.descripcion;
  assert.equal(detalleCortoCobro(mv, t, { recibo: 1022, cheque: { numero: "00000131", banco: "BANCO DE GALICIA Y BUENOS AIRES S.A.U.", estado: "depositado", fecha_deposito: "2026-10-17" } }),
    "Recibo 1022 · Cheque Galicia N° 131 · depositado 17/10/2026", "fecha de depósito, no el vencimiento");
  assert.equal(detalleCortoCobro(mv, t), "Cheque Galicia N° 131", "sin datos del cheque: número y banco del texto, sin vencimiento");
  assert.equal(detalleCortoCobro(mv, t, { cheque: { numero: "131", banco: "Galicia", estado: "en_cartera" } }), "Cheque Galicia N° 131 · sin depositar");
  assert.equal(detalleCortoCobro(mv, t, { cheque: { numero: "131", banco: "Galicia", estado: "endosado", fecha_endoso: "2026-10-02" } }), "Cheque Galicia N° 131 · endosado 02/10/2026");
  assert.equal(detalleCortoCobro({ id: "e", tipo: "cheque_recibido", monto: 1, fecha: null }, "Cobro — DEL SOL — eCheq 3644 Banco Galicia (pago 30/10/2026) — FC A 9-405"),
    "Cheque Galicia N° 3644");
  assert.equal(detalleCortoCobro({ id: "t", tipo: "transferencia", monto: 1, fecha: null }, "Cobro — Pedro — Ref: 2037 | CBU: 0170 — Facturas: FA 15-32", { recibo: 1030 }), "Recibo 1030 · Transferencia");
  assert.equal(detalleCortoCobro({ id: "r", tipo: "retencion_ganancias", monto: 1, fecha: null }, "Retención de Ganancias — OP: 0001-00018368 | Cert: 11426 | Régimen 078"), "Ret. Ganancias cert. 11426");
  assert.equal(detalleCortoCobro({ id: "a", tipo: "ajuste", monto: 1, fecha: null }, "[Ajuste manual] Factura impaga"), "[Ajuste manual] Factura impaga", "los ajustes quedan con su texto");
}

// ── NC que anula 3 facturas (Barraza, NC A 0001-00000025): 2 impagas anuladas y 1 ya cobrada (queda a favor).
{
  const facturas = [
    { id: "f10", tipo: "FA", punto_venta: 15, numero: 10, fecha: "2026-09-07", total: 7623000, total_acreditado: 7623000, moneda: "ARS", estado: "anulada" },
    { id: "f19", tipo: "FA", punto_venta: 15, numero: 19, fecha: "2026-09-15", total: 10110492.35, total_acreditado: 0, moneda: "ARS", estado: "pagada" },
    { id: "f30", tipo: "FA", punto_venta: 15, numero: 30, fecha: "2026-09-22", total: 9220848.56, total_acreditado: 9220848.56, moneda: "ARS", estado: "anulada" },
    { id: "nc25", tipo: "NCA", punto_venta: 1, numero: 25, fecha: "2026-09-30", total: 26954340.91, saldo_a_favor_cliente: 10110492.35, factura_origen_id: "f10", moneda: "ARS", estado: "emitida" },
  ];
  const movimientos = [{ id: "c131", tipo: "cheque_recibido", monto: 10110492.35, fecha: "2026-09-18", moneda: "ARS", factura_id: "f19" }];
  const ncAps = [{ nota_credito_id: "nc25", factura_id: "f10" }, { nota_credito_id: "nc25", factura_id: "f19" }, { nota_credito_id: "nc25", factura_id: "f30" }];
  const r = resumenCliente(facturas, movimientos as any, [], new Map(), ncAps);
  const nc = r.renglones.find((x) => x.id === "nc25")!;
  assert.equal(nc.haber, 26954340.91, "la NC entera en Haber");
  assert.equal(nc.nota, "anula FA 0015-00000010, FA 0015-00000019, FA 0015-00000030 · a favor $ 10.110.492,35");
  assert.equal(r.renglones.find((x) => x.id === "f10")!.debe, 7623000);
  assert.equal(r.renglones.find((x) => x.id === "c131")!.haber, 10110492.35, "el cheque de la FA 19 sigue sumando");
  assert.equal(r.saldo.ARS, -10110492.35, "a favor del cliente");
  // Sin las aplicaciones (como antes), la NC queda solo con su factura de origen.
  assert.equal(resumenCliente(facturas, movimientos as any, []).renglones.find((x) => x.id === "nc25")!.nota, "anula FA 0015-00000010 · a favor $ 10.110.492,35");
}

console.log("test-resumen-cuenta OK");
