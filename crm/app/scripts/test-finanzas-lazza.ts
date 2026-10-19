import assert from "node:assert/strict";
import { armarRetenciones, armarCuentasCorrientes, semaforoPorEntidad, tieneSaldo, armarTcDelDia, armarVencimientos, filtrarVencimientos, ivaDelMes, nivelObjetivo, reporteBasico, saldoFacturaCompra, unificarMoneda, sumarDias, conVencimiento, facturasACobrar, monedaDelCobro, type FacturaVentaFL } from "../src/lib/finanzas-lazza";

const tcDia = armarTcDelDia([{ fecha: "2026-10-09", valor_venta: 1400 }, { fecha: "2026-10-14", valor_venta: 1500 }]);
assert.equal(tcDia("2026-10-14"), 1500);
assert.equal(tcDia("2026-10-12"), 1400); // fin de semana / feriado: último anterior
assert.equal(tcDia("2026-10-01"), null);

const fv = (x: Partial<FacturaVentaFL> & { id: string }): FacturaVentaFL => ({ fecha: "2026-10-05", tipo: "FA", estado: "emitida", moneda: "ARS", subtotal: 0, iva: 0, total: 0, ...x });

const facturas: FacturaVentaFL[] = [
  fv({ id: "a", subtotal: 1000, iva: 210, total: 1210, presupuesto_id: "pa" }),
  // US$ al TC de la factura; su PR tiene costo en US$
  fv({ id: "b", fecha: "2026-10-14", moneda: "USD", subtotal: 100, iva: 21, total: 121, tipo_cambio: 1450, presupuesto_id: "pb" }),
  // NC parcial (mitad) de "a": resta venta y la mitad del costo
  fv({ id: "c", fecha: "2026-10-12", tipo: "NCA", subtotal: 500, iva: 105, total: 605, factura_origen_id: "a" }),
  // sin PR
  fv({ id: "d", subtotal: 200, iva: 42, total: 242 }),
  // anulada + su NC: desaparecen
  fv({ id: "e", estado: "anulada", subtotal: 9000, iva: 1890, total: 10890, presupuesto_id: "pe" }),
  fv({ id: "f", tipo: "NCA", subtotal: 9000, iva: 1890, total: 10890, factura_origen_id: "e" }),
  // otro mes
  fv({ id: "g", fecha: "2026-09-30", subtotal: 5000, iva: 1050, total: 6050, presupuesto_id: "pg" }),
  // factura en $ con costo en US$ → dólar BNA del día; y un ítem sin costo
  fv({ id: "h", fecha: "2026-10-12", subtotal: 3000, iva: 630, total: 3630, presupuesto_id: "ph" }),
];
const items = [
  { presupuesto_id: "pa", cantidad: 2, precio_costo: 300, costo_moneda: "ARS", iva_porcentaje: 21 },
  { presupuesto_id: "pb", cantidad: 1, precio_costo: 50, costo_moneda: "USD", iva_porcentaje: 21 },
  { presupuesto_id: "ph", cantidad: 1, precio_costo: 1, costo_moneda: "USD", iva_porcentaje: 10.5 },
  { presupuesto_id: "ph", cantidad: 3, precio_costo: 0, costo_moneda: "ARS", iva_porcentaje: 21 },
];
const gastos = [
  { fecha: "2026-10-01", monto: 1000, moneda: "ARS", tipo_recurrencia: "fijo" },
  { fecha: "2026-10-02", monto: 500, moneda: "ARS", tipo_recurrencia: "eventual", gasto_fijo_id: "gf" }, // atado a un fijo
  { fecha: "2026-10-03", monto: 700, moneda: "ARS", tipo_recurrencia: "eventual" },
  { fecha: "2026-10-14", monto: 10, moneda: "USD", tipo_recurrencia: "eventual" },
  { fecha: "2026-09-03", monto: 99999, moneda: "ARS", tipo_recurrencia: "eventual" },
];
const r = reporteBasico({ periodo: "2026-10", facturas, origenes: [], idsAnulados: [], items, prNumero: { pa: "PR-1", ph: "PR-8" }, gastos, tcDia });

// Facturado: a 1000 + b 145000 − c 500 + d 200 + h 3000 = 148700 neto
assert.equal(r.facturado.neto, 148700);
assert.equal(r.facturado.iva, 210 + 21 * 1450 - 105 + 42 + 630);
assert.equal(r.facturado.total, r.facturado.neto + r.facturado.iva);
// Costo: a 600 + b 50×1450=72500 − mitad de a 300 + h 1×1400=1400 → 74200
assert.equal(r.costo.neto, 74200);
assert.equal(r.costo.iva, 126 + 15225 - 63 + 147);
// Avisos: d sin PR, h con artículo sin costo
assert.deepEqual(r.avisos.map((a) => a.facturaId).sort(), ["d", "h"]);
assert.equal(r.avisos.find((a) => a.facturaId === "h")!.prNumero, "PR-8");
// Gastos: fijos 1500, eventuales 700 + 10×1500
assert.deepEqual(r.gastos, { fijos: 1500, eventuales: 15700, total: 17200, enUsdSinCotizacion: 0 });
// Resultado = neto venta − neto costo − gastos
assert.equal(r.resultado, 148700 - 74200 - 17200);

// NC cuya factura de origen es de otro mes: usa `origenes`
const r2 = reporteBasico({ periodo: "2026-10", facturas: [fv({ id: "n", tipo: "NCA", subtotal: 5000, iva: 1050, total: 6050, factura_origen_id: "g" })], origenes: [facturas[6]], idsAnulados: [], items: [{ presupuesto_id: "pg", cantidad: 1, precio_costo: 4000, costo_moneda: "ARS", iva_porcentaje: 21 }], prNumero: {}, gastos: [], tcDia });
assert.equal(r2.facturado.neto, -5000);
assert.equal(r2.costo.neto, -4000);

// US$ sin TC: no suma y avisa
const r3 = reporteBasico({ periodo: "2026-10", facturas: [fv({ id: "u", fecha: "2026-10-02", moneda: "USD", subtotal: 10, iva: 2.1, total: 12.1 })], origenes: [], idsAnulados: [], items: [], prNumero: {}, gastos: [], tcDia });
assert.equal(r3.facturado.neto, 0);
assert.equal(r3.sinCotizacion.length, 1);

// Objetivos
assert.equal(nivelObjetivo(63_999_999).nivel, "debajo");
assert.equal(nivelObjetivo(78_600_000).nivel, "minimo");
assert.equal(nivelObjetivo(78_600_000).proximo!.falta, 1_400_000);
assert.equal(nivelObjetivo(96_000_000).nivel, "muy_bueno");
assert.equal(nivelObjetivo(96_000_000).proximo, null);

// IVA: libro de ventas (anulada con CAE sigue y su NC la compensa); compras sin anuladas, NC restan, Solo IVA aparte
const iva = ivaDelMes({
  periodo: "2026-10",
  ventas: [
    fv({ id: "a", iva: 210, subtotal: 1000, total: 1210 }),
    fv({ id: "b", fecha: "2026-10-14", moneda: "USD", iva: 21, subtotal: 100, total: 121, tipo_cambio: 1450 }),
    fv({ id: "e", estado: "anulada", cae: "123", iva: 1890, subtotal: 9000, total: 10890 }),
    fv({ id: "f", tipo: "NCA", iva: 1890, subtotal: 9000, total: 10890, factura_origen_id: "e" }),
    fv({ id: "x", estado: "anulada", iva: 999, subtotal: 1, total: 1 }), // anulada sin CAE: no entra
  ],
  compras: [
    { id: "1", fecha: "2026-10-03", tipo_comprobante: "FC A", estado: "pendiente", moneda: "ARS", iva: 500 },
    { id: "2", fecha: "2026-10-04", tipo_comprobante: "NC A", estado: "pendiente", moneda: "ARS", iva: 100 },
    { id: "3", fecha: "2026-10-05", tipo_comprobante: "FC A", estado: "anulada", moneda: "ARS", iva: 7777 },
    { id: "4", fecha: "2026-10-14", tipo_comprobante: "FC A", estado: "pagada", moneda: "USD", iva: 2 },
    { id: "5", fecha: "2026-10-09", tipo_comprobante: "FC A", estado: "pagada", moneda: "ARS", iva: 300, solo_iva: true },
  ],
  tcDia,
});
assert.equal(iva.ventas.debito, 210 + 30450);
assert.equal(iva.compras.credito, 500 - 100 + 3000 + 300);
assert.equal(iva.compras.deSoloIva, 300);
assert.equal(iva.diferencia, 210 + 30450 - 3700);

// Vencimientos
const fc = { id: "p1", fecha: "2026-10-01", fecha_vencimiento: "2026-10-20", tipo_comprobante: "FC A", estado: "pendiente", moneda: "ARS", iva: 0, total: 1000, total_acreditado: 100,
  op_facturas_compra: [{ monto: 200, ordenes_pago: { estado: "emitida" } }, { monto: 999, ordenes_pago: { estado: "anulada" } }] };
const pagos = [{ factura_compra_id: "p1", monto: 300, retencion_ganancias_monto: 50 }, { factura_compra_id: "p1", monto: 9999, anulado: true }];
assert.equal(saldoFacturaCompra(fc, pagos), 350);
const venc = armarVencimientos({
  hoy: "2026-10-18",
  ventas: [fv({ id: "v1", total: 1210, fecha_vencimiento: "2026-10-10" } as any), fv({ id: "v2", total: 500 })],
  saldoVenta: (f) => (f.id === "v1" ? 1210 : 0),
  compras: [fc, { ...fc, id: "p2", estado: "pagada" }],
  pagosDirectos: pagos,
});
assert.deepEqual(venc.map((v) => [v.lado, v.id, v.saldo, v.dias]), [["venta", "v1", 1210, -8], ["compra", "p1", 350, 2]]);
assert.equal(venc[0].fecha, "2026-10-05");
// Filtros de vencimientos
assert.deepEqual(filtrarVencimientos(venc, { lado: "compra" }).map((v) => v.id), ["p1"]);
assert.deepEqual(filtrarVencimientos(venc, { situacion: "vencidas" }).map((v) => v.id), ["v1"]);
assert.deepEqual(filtrarVencimientos(venc, { situacion: "por_vencer" }).map((v) => v.id), ["p1"]);
assert.deepEqual(filtrarVencimientos(venc, { campoFecha: "vence", desde: "2026-10-15" }).map((v) => v.id), ["p1"]);
assert.deepEqual(filtrarVencimientos(venc, { campoFecha: "fecha", hasta: "2026-10-01" }).map((v) => v.id), ["p1"]);
assert.deepEqual(filtrarVencimientos(venc, { moneda: "USD" }), []);
assert.deepEqual(filtrarVencimientos([{ ...venc[0], nombre: "Peña Cía" }], { texto: "pena cia" }).length, 1);

// Cuentas corrientes
const vcc = [
  { ...venc[0], entidadId: "cli1" },
  { ...venc[1], entidadId: "prov1" },
];
const cc = armarCuentasCorrientes({
  clientes: [{ id: "cli1", razon_social: "Cliente 1", cuit: "1" }, { id: "cli2", razon_social: "Cero", cuit: "2" }],
  proveedores: [{ id: "prov1", razon_social: "Prov 1", cuit: "3" }],
  saldosClientes: { cli1: { ARS: { saldo: 1210 }, USD: { saldo: 0 } } },
  saldosProveedores: { prov1: { ARS: 350, USD: -10 } },
  vencimientos: vcc,
  bcraClientes: semaforoPorEntidad([{ entidad_id: "cli1", semaforo: "gris" }, { entidad_id: "cli1", semaforo: "amarillo" }, { entidad_id: "cli1", semaforo: "verde" }]),
});
assert.equal(cc.length, 3);
const c1 = cc.find((x) => x.id === "c-cli1")!;
assert.deepEqual([c1.saldo.ARS, c1.vencido.ARS, c1.facturas, c1.bcra], [1210, 1210, 1, "amarillo"]);
const p1 = cc.find((x) => x.id === "p-prov1")!;
assert.deepEqual([p1.saldo.ARS, p1.saldo.USD, p1.vencido.ARS, p1.proximoVencimiento], [350, -10, 0, "2026-10-20"]);
assert.deepEqual(cc.filter(tieneSaldo).map((x) => x.id), ["c-cli1", "p-prov1"]);

// Retenciones
const ret = armarRetenciones({
  ops: [
    { id: "o1", numero: "OP-000070", fecha: "2026-10-10", estado: "pagada", retencion_ganancias_monto: 1000, retencion_ganancias_pct: 2, base_retencion_ganancias: 50000, proveedores: { razon_social: "P", cuit: "9" } },
    { id: "o2", numero: "OP-000071", fecha: "2026-10-11", estado: "anulada", retencion_ganancias_monto: 999 },
    { id: "o3", numero: "OP-000072", fecha: "2026-10-12", estado: "pendiente", retencion_ganancias_monto: 0 },
  ],
  movimientos: [
    { id: "m1", tipo: "pago", fecha: "2026-10-05", monto: 5000, retencion_ganancias_monto: 200 },
    { id: "m2", tipo: "retencion_iibb", fecha: "2026-10-06", monto: 300, cliente_id: "c", clientes: { razon_social: "Corteva" } },
    { id: "m3", tipo: "retencion_iva", fecha: "2026-10-07", monto: 400, cliente_id: "c", anulado: true },
    { id: "m4", tipo: "retencion_ganancias", fecha: "2026-10-08", monto: 50, proveedor_id: "p" }, // practicada vieja sin OP: no se duplica
  ],
});
assert.deepEqual(ret.map((r) => [r.id, r.lado, r.impuesto, r.monto]), [["pd-m1", "practicada", "Ganancias", 200], ["rs-m2", "sufrida", "IIBB", 300], ["op-o1", "practicada", "Ganancias", 1000]]);

// Cuentas corrientes en una sola moneda
const tcU = { billete: 1000, divisa: 1100 };
assert.deepEqual(unificarMoneda({ ARS: 550000, USD: 100 }, "USD Divisa", tcU), { ARS: 0, USD: 600 });
assert.deepEqual(unificarMoneda({ ARS: 500000, USD: 100 }, "USD", tcU), { ARS: 0, USD: 600 });
assert.deepEqual(unificarMoneda({ ARS: 1000, USD: 10 }, "ARS", tcU), { ARS: 12000, USD: 0 });
assert.deepEqual(unificarMoneda({ ARS: 1000, USD: 10 }, null, { billete: 1000, divisa: null }), { ARS: 11000, USD: 0 });
assert.deepEqual(unificarMoneda({ ARS: 1000, USD: 10 }, "USD", { billete: null, divisa: null }), { ARS: 1000, USD: 10 });

// Vencimientos editables
assert.equal(sumarDias("2026-10-19", 30), "2026-11-18");
assert.equal(sumarDias("2026-02-27", 2), "2026-03-01");
const fvto = { lado: "venta" as const, id: "x", entidadId: "c", fecha: "2026-10-01", vence: "2026-10-01", sinVencimiento: true, comprobante: "FA", nombre: "C", moneda: "ARS" as const, total: 1, saldo: 1, dias: -18 };
assert.deepEqual([conVencimiento(fvto, "2026-10-31", "2026-10-19").dias, conVencimiento(fvto, "2026-10-31", "2026-10-19").sinVencimiento], [12, false]);

// Cobrar: facturas con saldo del cliente (sin NC ni anuladas), de la más vieja a la más nueva
const aCobrar = facturasACobrar([
  { id: "f2", tipo: "FA", punto_venta: 15, numero: 123, fecha: "2026-10-10", estado: "emitida", moneda: "ARS", subtotal: 1000, iva: 210, total: 1210, total_acreditado: 10 },
  { id: "f1", tipo: "FB", punto_venta: 15, numero: 99, fecha: "2026-10-01", estado: "parcial", moneda: "USD", subtotal: 100, iva: 21, total: 121, tipo_cambio: 1450 },
  { id: "f3", tipo: "FA", punto_venta: 15, numero: 124, fecha: "2026-10-02", estado: "emitida", moneda: "ARS", total: 500 },
  { id: "nc", tipo: "NCA", punto_venta: 15, numero: 5, fecha: "2026-10-03", estado: "emitida", moneda: "ARS", total: 300 },
  { id: "an", tipo: "FA", punto_venta: 15, numero: 6, fecha: "2026-10-03", estado: "anulada", moneda: "ARS", total: 300 },
], { f2: 200, f1: 21, f3: 500 });
assert.deepEqual(aCobrar.map((f) => [f.id, f.numero, f.saldo, f.moneda]), [["f1", "FB 0015-00000099", 100, "USD"], ["f2", "FA 0015-00000123", 1000, "ARS"]]);
assert.equal(aCobrar[0].tipo_cambio, 1450);
assert.equal(monedaDelCobro([aCobrar[1]]), "ARS");
assert.equal(monedaDelCobro(aCobrar), null);
assert.equal(monedaDelCobro([]), null);

console.log("test-finanzas-lazza OK");
