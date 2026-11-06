import assert from "node:assert/strict";
import { armarRetenciones, totalesRetenciones, excelRetencionesSufridas, rangoQuincena, practicadasPorQuincena, armarCuentasCorrientes, semaforoPorEntidad, tieneSaldo, saldoMenorA,armarTcDelDia, armarVencimientos, filtrarVencimientos, ivaDelMes, certificadoDeRetencion, periodoVepIva, esVepSinImpuesto, nivelObjetivo, reporteBasico, costoDeFactura, costoDelPr, esRenglonDeFlete, saldoFacturaCompra, unificarMoneda, sumarDias, conVencimiento, facturasACobrar, monedaDelCobro, clientesACobrar, proveedoresAPagar, type FacturaVentaFL, type FilaVencimiento } from "../src/lib/finanzas-lazza";

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
  { fecha: "2026-10-04", monto: 200, moneda: "ARS", tipo_recurrencia: "mensual" }, // «Fijo» de la pantalla Gastos se guarda como mensual: cuenta como fijo (arreglo 10)
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
// Gastos: fijos 1500 + 200 (mensual), eventuales 700 + 10×1500
assert.deepEqual(r.gastos, { fijos: 1700, eventuales: 15700, total: 17400, enUsdSinCotizacion: 0 });
// Sin "resultado" propio (auditoría de la plata 29/10/2026): el del mes sale de la Contabilidad (estadoDeResultados).
assert.equal("resultado" in r, false);

// Cruce de renglones factura ↔ PR (auditoría 29/10/2026): los espacios de más no lo rompen (antes /s+/ comía las "s").
const itemsCruce = [
  { presupuesto_id: "px", descripcion: "Campera softshell", cantidad: 4, precio_costo: 1000, costo_moneda: "ARS", iva_porcentaje: 21 },
  { presupuesto_id: "px", descripcion: "Pantalón cargo", cantidad: 4, precio_costo: 500, costo_moneda: "ARS", iva_porcentaje: 21 },
];
const parcial = costoDeFactura(itemsCruce, [{ factura_id: "fx", descripcion: "CAMPERA  SOFTSHELL ", cantidad: 2 }], fv({ id: "fx" }), tcDia);
assert.equal(parcial.aproximado, false); // se cruzó: solo lo facturado
assert.equal(parcial.costo.neto, 2000);
// "Perno" y "Pernos" no son el mismo renglón (antes se cruzaban porque se borraba la "s").
const distinto = costoDeFactura([{ presupuesto_id: "py", descripcion: "Pernos", cantidad: 10, precio_costo: 100, costo_moneda: "ARS", iva_porcentaje: 21 }],
  [{ factura_id: "fy", descripcion: "Perno", cantidad: 5 }], fv({ id: "fy" }), tcDia);
assert.equal(distinto.aproximado, true); // no se cruza: costo del PR entero y avisa

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
// Sin nada a cuenta, el estimado es débito − crédito, como antes
assert.deepEqual([iva.estimado, iva.compras.banco, iva.vep.diferencia, iva.percepciones.monto], [iva.diferencia, 0, null, 0]);

// IVA estimado (arreglo 16): textos reales de la base (retenciones de Corteva y Soychu, VEP de Gastos)
assert.equal(certificadoDeRetencion("Retención IVA — certificado 0000-00074421 (IVA 50 % s/ IVA $ 1.993.039,22) — CORTEVA AGRISCIENCE ARGENTINA SRL"), "0000-00074421");
assert.equal(certificadoDeRetencion("Retención IVA — certificado 34539 — Frigorífico de Aves Soychu SAICFIA — FA A 0008-00000660 (sistema anterior)"), "34539");
assert.equal(certificadoDeRetencion("Retención IVA — Cert: 123-45 — Obs"), "123-45"); // como lo arma la liquidación de cobro
assert.equal(certificadoDeRetencion("Retención IVA — Cert. N° 777"), "777");
assert.equal(certificadoDeRetencion("Retención IVA — 50 % s/ IVA $ 286.121,37 — certificado pendiente — CORTEVA AGRISCIENCE ARGENTINA SRL — FA 0015"), null);
assert.equal(certificadoDeRetencion("Cobro FX — retencion_iva Cert. A CONFIRMAR — IVA 50 % s/ IVA $ 2.962.042,52 — Corteva Payment Advice 20.10.2026 ref 01671600159017 [cor-20/10] | TC 1524.5 del 2026-10-20"), null);
assert.equal(certificadoDeRetencion("Retención IIBB — certificado a pedir"), null);
assert.equal(certificadoDeRetencion(null), null);
// Retenciones sufridas (arreglo 14): más textos reales de la base
assert.equal(certificadoDeRetencion("Retención Ganancias — certificado RG 16418 — Limagrain Argentina Semillas SA — FA A 0008-00000670 $311.299,00"), "RG 16418");
assert.equal(certificadoDeRetencion("Cobro FX — retencion_iibb RB 25897 | TC 1520 del 2026-10-06"), "RB 25897"); // cobro en US$
assert.equal(certificadoDeRetencion("Cobro FX — retencion_ganancias 000000002302 | TC 1530 del 2026-10-03"), "000000002302");
assert.equal(certificadoDeRetencion("Cobro FX — retencion_iibb 0000-00000991 | TC 1530 del 2026-10-04"), "0000-00000991");
assert.equal(certificadoDeRetencion("Cobro FX — retencion_ganancias Cert. A CONFIRMAR — OP Termo 000100015634 / LRAFGN7562 (parte FA 15-18 a TC 1530) [mail-16/10] | TC 1530 del 2026-10-15"), null);
assert.equal(certificadoDeRetencion("0000-00002291 — TERMO CORDOBA SAU — Retención Impuesto a las Ganancias - Enajenación de bienes muebles"), "0000-00002291");
assert.equal(certificadoDeRetencion("2026-504 — Augusto Lazzari — Retención Impuesto a las Ganancias - Servicios"), "2026-504");
assert.equal(certificadoDeRetencion("2026-10-14 — Retención de IIBB"), null); // una fecha adelante no es N°
assert.equal(certificadoDeRetencion("Retención de Ganancias — Corteva Seeds (certificado 15/10, parte dólares) — Facturas: FA 00015-00000013"), null); // fecha, no N°
assert.equal(certificadoDeRetencion("Retención de Ganancias — OP: 0001-00016902 | Ref: Cert: 11592 | AFIP | Retención acumulada ya efectuada: $193792.37"), "11592");
assert.equal(certificadoDeRetencion("Retención Ganancias $206.067,88 (según recibo 782; OP 0001-00001483, Cert: 11236)"), "11236");
assert.equal(certificadoDeRetencion("Cert. 0000-00006005 IIBB Bs As"), "0000-00006005");
assert.equal(certificadoDeRetencion("Retención Ganancias — certificado A PEDIR a Chacraservicios (mail de Augusto 16/10/2026) — 2 % s/neto $1.054.105,10"), null);
assert.equal(certificadoDeRetencion("Retención de Ganancias — FUNDACION CARGILL — aviso de pago 59016581 (certificado a pedir a Cargill)"), null);
assert.equal(certificadoDeRetencion("Retención de IIBB — TERMO CORDOBA S.A.U. | Ref: LRADGc0932 / Nro. Transferencia 5 — Facturas: FA 00015-00000017"), null);
assert.equal(certificadoDeRetencion("DN43 — INDUSTRIAS METALURGICAS TODD — RETENCION DN43 (BS. AS.)"), null); // régimen, no N°

assert.equal(periodoVepIva({ fecha: "2026-10-21", descripcion: "ARCA VEP — VEP IVA — pago 21/10 (BBVA OP1396)" }), "2026-09"); // sin período: el mes anterior al pago
assert.equal(periodoVepIva({ fecha: "2026-10-21", descripcion: "ARCA VEP — IVA — pago 21/10/2026" }), "2026-09"); // la fecha de pago no es el período
assert.equal(periodoVepIva({ fecha: "2026-11-20", descripcion: "IVA - DDJJ - período 10/2026 (VEP 123)" }), "2026-10"); // como lo arma «Leer VEP (IA)»
assert.equal(periodoVepIva({ fecha: "2026-12-02", descripcion: "VEP IVA septiembre 2026" }), "2026-09");
assert.equal(periodoVepIva({ fecha: "2026-09-29", descripcion: "Compra crédito fiscal IVA — FC 00005-00019878" }), null);
assert.equal(periodoVepIva({ fecha: "2026-10-21", descripcion: "ARCA VEP — SICORE septiembre 2026 — retenciones de Ganancias (VEP 1696995778) — pago 21/10" }), null);
assert.equal(periodoVepIva({ fecha: "2026-09-30", descripcion: "Banco Nación — liquidación mensual septiembre 2026: comisión $ 11.600 + IVA 10,5 % $ 1.218" }), null);
assert.equal(periodoVepIva({ fecha: "2026-10-05", descripcion: "ARCA VEP — IVA plan de facilidades cuota 3" }), null);
assert.equal(esVepSinImpuesto("ARCA VEP — pago 16/10 (BBVA OP8808)"), true);
assert.equal(esVepSinImpuesto("ARCA VEP — Anticipo de Ganancias 2 (VEP 1696573116) — pago 21/10 (BBVA OP3708)"), false);
assert.equal(esVepSinImpuesto("ARCA VEP — SICORE octubre 2026 — pago a cuenta de Ganancias — pago 21/10 (BBVA OP5532)"), false);
assert.equal(esVepSinImpuesto("ARCA VEP — VEP IVA — pago 21/10 (BBVA OP1396)"), false);
assert.equal(esVepSinImpuesto("ARCA Autónomos — período 09/2026, categoría 302 (transacción 3236)"), false);

const ivaEst = ivaDelMes({
  periodo: "2026-09",
  ventas: [fv({ id: "v1", fecha: "2026-09-10", iva: 10000, subtotal: 47619.05, total: 57619.05 })],
  compras: [
    { id: "c1", fecha: "2026-09-12", tipo_comprobante: "FC A", estado: "pendiente", moneda: "ARS", iva: 2000, percepciones: 300 },
    { id: "c2", fecha: "2026-09-13", tipo_comprobante: "NC A", estado: "pendiente", moneda: "ARS", iva: 100, percepciones: 30 },
    { id: "c3", fecha: "2026-09-14", tipo_comprobante: "FC A", estado: "anulada", moneda: "ARS", iva: 999, percepciones: 999 },
  ],
  tcDia,
  lineasBanco: [
    { id: "b1", fecha: "2026-09-05", descripcion: "IVA TASA GRA #236", monto: 210, tipo: "debito", clasificacion: "impuesto", subtipo: "iva" },
    { id: "b2", fecha: "2026-09-06", descripcion: "IVA TASA GENERAL #236", monto: 21, tipo: "credito", clasificacion: null, subtipo: null }, // devolución: resta
    { id: "b3", fecha: "2026-09-07", descripcion: "COMISION #037", monto: 1000, tipo: "debito", clasificacion: null, subtipo: null }, // comisión, no IVA
    { id: "b4", fecha: "2026-09-08", descripcion: "IVA S/COMISION", monto: 50, tipo: "debito", clasificacion: "impuesto", subtipo: "iva" }, // sin código, clasificada a mano
    { id: "b5", fecha: "2026-10-01", descripcion: "IVA TASA GRA #236", monto: 999, tipo: "debito", clasificacion: null, subtipo: null }, // otro mes
  ],
  retenciones: [
    { id: "r1", fecha: "2026-09-03", monto: 3000, moneda: "ARS", descripcion: "Retención IVA — certificado 0000-00074421 — CORTEVA", cliente: "Corteva" },
    { id: "r2", fecha: "2026-09-20", monto: 500, moneda: "ARS", descripcion: "Retención IVA — certificado pendiente — CORTEVA", cliente: "Corteva" },
    { id: "r3", fecha: "2026-09-21", monto: 777, moneda: "ARS", anulado: true, descripcion: "Retención IVA — certificado 1" },
    { id: "r4", fecha: "2026-10-02", monto: 888, moneda: "ARS", descripcion: "Retención IVA — certificado 2" }, // otro mes
  ],
  gastos: [
    { id: "g1", fecha: "2026-10-21", monto: 4000, moneda: "ARS", descripcion: "ARCA VEP — VEP IVA — pago 21/10 (BBVA OP1396)" },
    { id: "g2", fecha: "2026-10-16", monto: 2520000, moneda: "ARS", descripcion: "ARCA VEP — pago 16/10 (BBVA OP8808)" },
    { id: "g3", fecha: "2026-09-17", monto: 507390, moneda: "ARS", descripcion: "ARCA VEP — pago 17/09 (BBVA OP8721)" }, // sin impuesto, pero pagado en el mismo mes: es de agosto
    { id: "g4", fecha: "2026-09-29", monto: 1616059.2, moneda: "ARS", descripcion: "Compra crédito fiscal IVA — FC 00005-00019878" },
    { id: "g5", fecha: "2026-11-20", monto: 9999, moneda: "ARS", descripcion: "ARCA VEP — VEP IVA — pago 20/11" }, // IVA de octubre
  ],
});
assert.equal(ivaEst.ventas.debito, 10000);
assert.deepEqual([ivaEst.compras.banco, ivaEst.compras.filasBanco.length], [210 - 21 + 50, 3]);
assert.equal(ivaEst.compras.credito, 2000 - 100 + 239);
assert.equal(ivaEst.diferencia, 10000 - 2139);
assert.deepEqual([ivaEst.retenciones.conCertificado, ivaEst.retenciones.sinCertificado, ivaEst.retenciones.filas.length], [3000, 500, 2]);
assert.equal(ivaEst.estimado, 10000 - 2139 - 3000); // la de sin certificado no se resta
assert.deepEqual([ivaEst.vep.pagado, ivaEst.vep.filas.map((f) => f.id), ivaEst.vep.diferencia, ivaEst.vep.coincide], [4000, ["g1"], 4000 - 4861, true]);
assert.deepEqual([ivaEst.vep.sinImpuesto.monto, ivaEst.vep.sinImpuesto.filas.map((f) => f.id)], [2520000, ["g2"]]);
assert.deepEqual([ivaEst.percepciones.monto, ivaEst.percepciones.filas.length], [270, 2]);
// Compras en US$ (06/11/2026): con el TC de la factura (el de ARCA); sin TC, el dólar BNA del día.
const ivaUsd = ivaDelMes({ periodo: "2026-10", ventas: [], tcDia, compras: [
  { id: "u1", fecha: "2026-10-14", tipo_comprobante: "FC A", estado: "pagada", moneda: "USD", iva: 598.5, tipo_cambio: 1512.5 },
  { id: "u2", fecha: "2026-10-14", tipo_comprobante: "FC A", estado: "pagada", moneda: "USD", iva: 100 },
  { id: "u3", fecha: "2026-10-14", tipo_comprobante: "NC A", estado: "recibida", moneda: "USD", iva: 10, tipo_cambio: "1506.5" },
] });
assert.deepEqual(ivaUsd.compras.filas.map((f) => f.iva), [905231.25, 150000, -15065]);
// A favor y VEP que no coincide (caso septiembre: el estimado da a favor y se pagó un VEP)
const ivaFavor = ivaDelMes({ periodo: "2026-09", ventas: [], compras: [], tcDia, retenciones: [{ id: "r", fecha: "2026-09-03", monto: 5000, descripcion: "certificado 9" }],
  gastos: [{ id: "g", fecha: "2026-10-21", monto: 1500, descripcion: "ARCA VEP — VEP IVA — pago 21/10" }] });
assert.deepEqual([ivaFavor.estimado, ivaFavor.vep.diferencia, ivaFavor.vep.coincide], [-5000, 6500, false]);

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
// Saldos de centavos (arreglo 25): menos de $ 100 en cada moneda (US$ al dólar del día); sin saldo o sin dólar, no
const fcc = (ARS: number, USD = 0) => ({ ...c1, saldo: { ARS, USD } });
assert.deepEqual([fcc(-0.99), fcc(8.27), fcc(-14.83), fcc(-99.99), fcc(100), fcc(-100.5), fcc(0)].map((f) => saldoMenorA(f, 1500)), [true, true, true, true, false, false, false]);
assert.deepEqual([fcc(0, 0.05), fcc(0, 0.07), fcc(50, 0.05), fcc(-480000, 0.05)].map((f) => saldoMenorA(f, 1500)), [true, false, true, false]);
assert.deepEqual([saldoMenorA(fcc(0, 0.05), 0), saldoMenorA(fcc(5), 0)], [false, true]);

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
assert.deepEqual(ret.map((r) => [r.origen, r.certificado, r.faltaCertificado]), [["Pago directo", null, false], ["", null, true], ["OP-000070", null, false]]);
assert.equal(armarRetenciones({ ops: [{ id: "o9", numero: 49, fecha: "2026-10-07", retencion_ganancias_monto: 1 }], movimientos: [] })[0].origen, "OP 49");

// Retenciones sufridas (arreglo 14): N° de certificado o "falta", recibo como origen, totales por impuesto y Excel
const suf = armarRetenciones({
  ops: [],
  movimientos: [
    { id: "s1", tipo: "retencion_iva", fecha: "2026-10-13", monto: 143060.69, cliente_id: "c", clientes: { razon_social: "Corteva", cuit: "30-1" }, descripcion: "Retención IVA — 50 % s/ IVA $ 286.121,37 — certificado pendiente" },
    { id: "s2", tipo: "retencion_ganancias", fecha: "2026-10-04", monto: 17201.04, cliente_id: "t", clientes: { razon_social: "Termo", cuit: "30-2" }, descripcion: "Cobro FX — retencion_ganancias 000000002302 | TC 1530 del 2026-10-03" },
    { id: "s3", tipo: "retencion_iibb", fecha: "2026-10-04", monto: 18471.8, cliente_id: "t", clientes: { razon_social: "Termo", cuit: "30-2" }, descripcion: "Cobro FX — retencion_iibb 000000001115 | TC 1530 del 2026-10-03" },
    { id: "s4", tipo: "retencion_iva", fecha: "2026-10-20", monto: 1000, cliente_id: "c", clientes: { razon_social: "Corteva", cuit: "30-1" }, descripcion: "Retención IVA — certificado 0000-00074421" },
  ],
  recibos: { s1: { id: "r52", numero: 1052 }, s2: { id: "r41", numero: 1041 }, s3: { id: "r41", numero: 1041 } },
});
assert.deepEqual(suf.map((r) => [r.id, r.origen, r.certificado, r.faltaCertificado, r.recibo?.numero ?? null]), [
  ["rs-s2", "Recibo 1041", "000000002302", false, 1041],
  ["rs-s3", "Recibo 1041", "000000001115", false, 1041],
  ["rs-s1", "Recibo 1052", null, true, 1052],
  ["rs-s4", "", "0000-00074421", false, null], // sin recibo: el origen queda vacío
]);
assert.equal(suf[2].detalle, "Retención IVA — 50 % s/ IVA $ 286.121,37 — certificado pendiente");
assert.deepEqual(totalesRetenciones(suf).map((t) => [t.impuesto, t.cantidad, t.monto, t.faltan, t.montoFalta]), [
  ["IVA", 2, 144060.69, 1, 143060.69], ["Ganancias", 1, 17201.04, 0, 0], ["IIBB", 1, 18471.8, 0, 0],
]);
const xls = excelRetencionesSufridas(suf);
assert.deepEqual(xls[0], ["Fecha", "Impuesto", "Cliente", "CUIT", "Certificado", "Recibo", "Retenido", "Detalle completo"]);
assert.deepEqual(xls[3].slice(0, 7), ["13/10/2026", "IVA", "Corteva", "30-1", "falta", 1052, 143060.69]);
assert.deepEqual(xls[4].slice(4, 6), ["0000-00074421", ""]);
assert.deepEqual(xls.slice(5), [
  [], ["Impuesto", "Con certificado", "Falta certificado", "Total"],
  ["IVA", 1000, 143060.69, 144060.69], ["Ganancias", 17201.04, 0, 17201.04], ["IIBB", 18471.8, 0, 18471.8],
  ["Total", 36672.84, 143060.69, 179733.53],
]);
// Con alguna en US$: columna Moneda y totales por moneda
const xlsUsd = excelRetencionesSufridas([...suf.slice(0, 1), { ...suf[0], id: "u", moneda: "USD", monto: 10 }]);
assert.deepEqual([xlsUsd[0][6], xlsUsd[2][6], xlsUsd.slice(-2).map((f) => f[0])], ["Moneda", "US$", ["Total ($)", "Total (US$)"]]);

// Practicadas por quincena (arreglo 15): 1ª del 1 al 15, 2ª del 16 a fin de mes, y el mes; las sufridas no cuentan
assert.deepEqual(rangoQuincena("2026-10", "primera"), { desde: "2026-10-01", hasta: "2026-10-15" });
assert.deepEqual(rangoQuincena("2026-10", "segunda"), { desde: "2026-10-16", hasta: "2026-10-31" });
assert.deepEqual(rangoQuincena("2026-09", "mes"), { desde: "2026-09-01", hasta: "2026-09-30" });
assert.deepEqual(rangoQuincena("2028-02", "segunda"), { desde: "2028-02-16", hasta: "2028-02-29" });
const quin = practicadasPorQuincena(armarRetenciones({
  ops: [
    { id: "q1", numero: "OP-000060", fecha: "2026-10-15", estado: "pagada", retencion_ganancias_monto: 677000.73 },
    { id: "q2", numero: "OP-000061", fecha: "2026-10-16", estado: "pagada", retencion_ganancias_monto: 357780.59 },
    { id: "q3", numero: "OP-000062", fecha: "2026-09-30", estado: "pagada", retencion_ganancias_monto: 5 },
    { id: "q4", numero: "OP-000063", fecha: "2026-10-01", estado: "anulada", retencion_ganancias_monto: 9 },
  ],
  movimientos: [
    { id: "q5", tipo: "pago", fecha: "2026-10-01", monto: 1, retencion_ganancias_monto: 120 },
    { id: "q6", tipo: "retencion_ganancias", fecha: "2026-10-02", monto: 777, cliente_id: "c" },
  ],
}), "2026-10");
assert.deepEqual(quin.map((t) => [t.cual, t.desde, t.hasta, t.cantidad, t.total]), [
  ["primera", "2026-10-01", "2026-10-15", 2, { ARS: 677120.73, USD: 0 }],
  ["segunda", "2026-10-16", "2026-10-31", 1, { ARS: 357780.59, USD: 0 }],
  ["mes", "2026-10-01", "2026-10-31", 3, { ARS: 1034901.32, USD: 0 }],
]);

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

// Pantalla Cobrar: un renglón por cliente, la deuda más vieja primero
const vv = (x: Partial<FilaVencimiento>): FilaVencimiento => ({ ...fvto, ...x });
const porCliente = clientesACobrar([
  vv({ id: "1", entidadId: "a", nombre: "A", vence: "2026-10-25", dias: 6, saldo: 100 }),
  vv({ id: "2", entidadId: "a", nombre: "A", vence: "2026-10-01", dias: -18, saldo: 50, moneda: "USD" }),
  vv({ id: "3", entidadId: "b", nombre: "B", vence: "2026-10-10", dias: -9, saldo: 30 }),
  vv({ id: "4", lado: "compra", entidadId: "p", nombre: "P", vence: "2026-09-01", dias: -48, saldo: 999 }),
  vv({ id: "5", entidadId: null, nombre: "?", saldo: 5 }),
]);
assert.deepEqual(porCliente.map((c) => [c.clienteId, c.facturas, c.saldo, c.vencido, c.dias]), [
  ["a", 2, { ARS: 100, USD: 50 }, { ARS: 0, USD: 50 }, -18],
  ["b", 1, { ARS: 30, USD: 0 }, { ARS: 30, USD: 0 }, -9],
]);

// Pantalla Pagar: lo mismo del lado de compras (proveedores)
const porProveedor = proveedoresAPagar([
  vv({ id: "1", entidadId: "a", nombre: "A", vence: "2026-10-25", dias: 6, saldo: 100 }),
  vv({ id: "4", lado: "compra", entidadId: "p", nombre: "P", vence: "2026-10-20", dias: 1, saldo: 200 }),
  vv({ id: "6", lado: "compra", entidadId: "p", nombre: "P", vence: "2026-09-01", dias: -48, saldo: 999.5, moneda: "USD" }),
  vv({ id: "7", lado: "compra", entidadId: "q", nombre: "Q", vence: "2026-10-30", dias: 11, saldo: 10 }),
  vv({ id: "8", lado: "compra", entidadId: "q", nombre: "Q", vence: "2026-10-30", dias: 11, saldo: 0 }),
]);
assert.deepEqual(porProveedor.map((p) => [p.proveedorId, p.facturas, p.saldo, p.vencido, p.dias]), [
  ["p", 2, { ARS: 200, USD: 999.5 }, { ARS: 0, USD: 999.5 }, -48],
  ["q", 1, { ARS: 10, USD: 0 }, { ARS: 0, USD: 0 }, 11],
]);

// ── Costo de lo realmente facturado (28/10/2026): factura parcial de un PR (caso Synertech PR-2026-1218) ──
{
  const prItems = [
    { presupuesto_id: "ps", descripcion: "RESPIRADOR N95", cantidad: 1000, precio_costo: 1.5, costo_moneda: "USD", iva_porcentaje: 21 },
    { presupuesto_id: "ps", descripcion: "ROLLO DE FIBRA VERDE", cantidad: 4, precio_costo: 50000, costo_moneda: "ARS", iva_porcentaje: 21 },
    { presupuesto_id: "ps", descripcion: "SUSPENSION 3M P/ CASCO", cantidad: 12, precio_costo: 9, costo_moneda: "USD", iva_porcentaje: 21 },
  ];
  const parcial = fv({ id: "par", fecha: "2026-10-14", moneda: "USD", subtotal: 500, iva: 105, total: 605, tipo_cambio: 1500, presupuesto_id: "ps" });
  // Se facturó: 200 de los 1000 respiradores y el rollo; la suspensión no. Las descripciones llegan con otras mayúsculas y acentos.
  const itemsFactura = [
    { factura_id: "par", descripcion: "Respirador n95", cantidad: 200 },
    { factura_id: "par", descripcion: "Rollo de fibra verde ", cantidad: 4 },
  ];
  const conRenglones = reporteBasico({ periodo: "2026-10", facturas: [parcial], origenes: [], idsAnulados: [], items: prItems, itemsFactura, prNumero: {}, gastos: [], tcDia });
  // 200 × US$ 1,5 × 1500 = 450.000 + 4 × 50.000 = 200.000 → 650.000 (no los 2.250.000 + 200.000 + 162.000 del PR entero)
  assert.equal(conRenglones.costo.neto, 650000);
  assert.equal(conRenglones.avisos.length, 0);
  // Sin renglones de la factura: costo del PR entero, como antes (sin aviso: no hay con qué cruzar)
  const sinRenglones = reporteBasico({ periodo: "2026-10", facturas: [parcial], origenes: [], idsAnulados: [], items: prItems, prNumero: {}, gastos: [], tcDia });
  assert.equal(sinRenglones.costo.neto, 1000 * 1.5 * 1500 + 200000 + 12 * 9 * 1500);
  // Un renglón de la factura que no está en el PR: se toma el PR entero y avisa
  const noCruza = reporteBasico({ periodo: "2026-10", facturas: [parcial], origenes: [], idsAnulados: [], items: prItems, itemsFactura: [{ factura_id: "par", descripcion: "Flete", cantidad: 1 }], prNumero: {}, gastos: [], tcDia });
  assert.equal(noCruza.costo.neto, sinRenglones.costo.neto);
  assert.match(noCruza.avisos[0]?.motivo || "", /no coinciden/);
  // Dos facturas del mismo PR (resto): cada una lleva el costo de lo suyo, no el PR entero dos veces
  const resto = fv({ id: "res", fecha: "2026-10-20", moneda: "USD", subtotal: 800, iva: 168, total: 968, tipo_cambio: 1500, presupuesto_id: "ps" });
  const dos = reporteBasico({ periodo: "2026-10", facturas: [parcial, resto], origenes: [], idsAnulados: [], items: prItems,
    itemsFactura: [...itemsFactura, { factura_id: "res", descripcion: "RESPIRADOR N95", cantidad: 800 }, { factura_id: "res", descripcion: "Suspension 3M p/ casco", cantidad: 12 }],
    prNumero: {}, gastos: [], tcDia });
  assert.equal(dos.costo.neto, 650000 + 800 * 1.5 * 1500 + 12 * 9 * 1500);
  // NC de una factura parcial: resta la parte proporcional del costo de lo que se facturó (no del PR entero)
  const nc = fv({ id: "ncp", fecha: "2026-10-22", tipo: "NCA", moneda: "USD", subtotal: 250, iva: 52.5, total: 302.5, tipo_cambio: 1500, factura_origen_id: "par" });
  const conNc = reporteBasico({ periodo: "2026-10", facturas: [nc], origenes: [parcial], idsAnulados: [], items: prItems, itemsFactura, prNumero: {}, gastos: [], tcDia });
  assert.equal(conNc.costo.neto, -325000); // mitad de 650.000
}

// ── Transportes (29/10/2026): Reportes resta las facturas de transporte del mes (neto) ──
{
  const conTr = reporteBasico({ periodo: "2026-10", facturas: [fv({ id: "v1", subtotal: 100000, iva: 21000, total: 121000 })], origenes: [], idsAnulados: [], items: [], prNumero: {}, gastos: [],
    transportes: [
      { fecha: "2026-10-20", subtotal: 72000, iva: 0, total: 72000, moneda: "ARS" },
      { fecha: "2026-10-10", subtotal: 10000, iva: 2100, total: 12100, moneda: "ARS" },
      { fecha: "2026-09-30", subtotal: 99999, iva: 0, total: 99999, moneda: "ARS" }, // otro mes: no suma
    ], tcDia });
  assert.equal(conTr.transportes.neto, 82000);
  assert.equal(conTr.transportes.total, 84100);
  assert.equal(conTr.transportes.n, 2);
  const sinTr = reporteBasico({ periodo: "2026-10", facturas: [], origenes: [], idsAnulados: [], items: [], prNumero: {}, gastos: [], tcDia });
  assert.deepEqual(sinTr.transportes, { neto: 0, iva: 0, total: 0, n: 0 });
}

console.log("test-finanzas-lazza OK");

// Costo raro (29/10/2026, caso PR-2026-1142): costo en la moneda equivocada → aviso arriba en Reportes.
{
  const fRaro = fv({ id: "raro", fecha: "2026-10-15", presupuesto_id: "praro", subtotal: 49173.75, iva: 10326.49, total: 59500.24 });
  const rRaro = reporteBasico({ periodo: "2026-10", facturas: [fRaro], origenes: [], idsAnulados: [], items: [{ presupuesto_id: "praro", cantidad: 1, precio_costo: 36425, costo_moneda: "USD", iva_porcentaje: 21 }], prNumero: { praro: "PR-2026-1142" }, gastos: [], tcDia });
  const aRaro = rRaro.avisos.find((a) => a.facturaId === "raro");
  assert.equal(aRaro?.costoRaro, true);
  assert.match(aRaro!.motivo, /Costo raro: .* veces la venta/);
  const rBien = reporteBasico({ periodo: "2026-10", facturas: [fRaro], origenes: [], idsAnulados: [], items: [{ presupuesto_id: "praro", cantidad: 1, precio_costo: 36425, costo_moneda: "ARS", iva_porcentaje: 21 }], prNumero: {}, gastos: [], tcDia });
  assert.equal(rBien.avisos.some((a) => a.costoRaro), false);
  console.log("costo raro OK");
}

// ── Flete (Augusto 29/10/2026): su costo no va en el PR; se cuenta solo por Transportes ──
{
  for (const d of ["LOGISTICA TACHOS,MESA Y SILLAS", "Logistica taza", "Envio", "Envíos", "TRASLADOS PERSONAL", "Servicio de logística: envío de Armario a Mendoza", "Fletes", "Costo de envío"])
    assert.equal(esRenglonDeFlete(d), true, d);
  for (const d of ["SILLA DE RUEDAS DE TRANSFERENCIA CON ELEVACIÓN Y TRASLADO", "LONA CONFECCIONADA EN LONA DE CAMION", "Respirador N95", "Transportador de rodillos", "", null])
    assert.equal(esRenglonDeFlete(d), false, String(d));
  // PR-1224 (Termo): el renglón de logística tenía costo y el viaje ya estaba en Transportes → restaba dos veces
  const items = [
    { presupuesto_id: "pt", descripcion: "MESA PLEGABLE", cantidad: 2, precio_costo: 100000, costo_moneda: "ARS", iva_porcentaje: 21 },
    { presupuesto_id: "pt", descripcion: "LOGISTICA TACHOS,MESA Y SILLAS", cantidad: 1, precio_costo: 313202, costo_moneda: "ARS", iva_porcentaje: 21 },
    { presupuesto_id: "pt", descripcion: "Envio", cantidad: 1, precio_costo: 0, costo_moneda: "ARS", iva_porcentaje: 21 },
  ];
  const c = costoDelPr(items, { moneda: "ARS", tipo_cambio: null, fecha: "2026-10-09" }, tcDia);
  assert.equal(c.costo.neto, 200000); // solo las mesas
  assert.equal(c.sinCosto, 0, "el flete en 0 no es un artículo sin costo");
  const r = reporteBasico({ periodo: "2026-10", facturas: [fv({ id: "ft", fecha: "2026-10-09", subtotal: 600000, iva: 126000, total: 726000, presupuesto_id: "pt" })], origenes: [], idsAnulados: [], items, prNumero: {}, gastos: [], tcDia });
  assert.equal(r.costo.neto, 200000);
  assert.equal(r.avisos.length, 0);
  console.log("flete OK");
}
