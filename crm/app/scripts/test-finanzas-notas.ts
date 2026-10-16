// Prueba de lib/finanzas-notas.ts: npx tsx scripts/test-finanzas-notas.ts
import { notaLiteral, notaCobro, armarCobroSistemaAnterior } from "../src/lib/finanzas-notas";

let fallas = 0;
function ok(cond: boolean, msg: string) { if (!cond) { fallas++; console.error("✗", msg); } else console.log("✓", msg); }
const base = { fecha: "2026-10-14", concepto: "", importe: -100 };

ok(notaLiteral({ ...base, concepto: "Impuesto Ley 25.413", importe: -7526.79, clasificacion: "impuesto", subtipo: "ley_25413" }).includes("sobre débitos: $ 7.526,79"), "Ley 25.413 débitos");
ok(notaLiteral({ ...base, concepto: "LEY NRO 25.413 SOBRE CREDIT", clasificacion: "impuesto", subtipo: "ley_25413" }).includes("créditos"), "Ley 25.413 créditos");
ok(notaLiteral({ ...base, concepto: "REG REC SIRCREB 03/09/26 00005X", importe: -639571.25, clasificacion: "impuesto", subtipo: "sircreb" }).includes("acreditaciones del 03/09: $ 639.571,25. Es pago a cuenta de IIBB"), "SIRCREB con fecha");
ok(notaLiteral({ ...base, concepto: "IVA TASA GENERAL", importe: -63, clasificacion: "impuesto", subtipo: "iva" }).includes("IVA 21 %"), "IVA comisión");
ok(notaLiteral({ ...base, concepto: "COMISION EMISION ECHEQ", importe: -82.64, clasificacion: "gasto_bancario" }).includes("e-cheq"), "comisión e-cheq");
ok(notaLiteral({ ...base, concepto: "COMI TRANSFERENCIA", importe: -300, clasificacion: "gasto_bancario" }).includes("transferencia"), "comisión transferencia");
ok(notaLiteral({ ...base, concepto: "PAGO CHEQUE 48HS CAP.FED. N 90017198", importe: -203038, clasificacion: "cheque_emitido", cheque: { numero: "90017198", destino_nombre: "SEGUFER SA" } }) === "Cheque propio N° 90017198 debitado — entregado a SEGUFER SA: $ 203.038,00.", "cheque emitido con destino");
ok(notaLiteral({ ...base, concepto: "PAGO CHEQUE 48HS N 90017135", importe: -612060.4, clasificacion: "cheque_emitido" }).includes("N° 90017135"), "cheque emitido sin datos del CRM");
ok(notaLiteral({ ...base, concepto: "Operacion FCI Nro:00000071", importe: 2000000, clasificacion: "fci" }).startsWith("Rescate"), "FCI entra = rescate");
ok(notaLiteral({ ...base, concepto: "Operacion FCI Nro:00000071", importe: -35000000, clasificacion: "fci" }).startsWith("Suscripción"), "FCI sale = suscripción");
ok(notaLiteral({ ...base, concepto: "CUENTA VISA NRO. 1190996722533", importe: -9792257.37, clasificacion: "tarjeta" }).includes("Visa (cuenta 1190996722533)"), "tarjeta Visa");
ok(notaLiteral({ ...base, concepto: "TRANSFERENCIA CCP091 312483 1", importe: -8000000, clasificacion: "entre_cuentas", contraCuenta: "BBVA CC EPP LAZZARI" }).includes("sale $ 8.000.000,00 a BBVA CC EPP LAZZARI"), "entre cuentas con contra cuenta");
ok(notaLiteral({ ...base, concepto: "TRANSFERENCIA", importe: -360000, clasificacion: "pago", movimiento: "Pago OP 0001-00000043 — SEGUFER" }).includes("SEGUFER"), "pago con movimiento");
ok(notaLiteral({ ...base, concepto: "X", importe: -10, clasificacion: "personal", nota: "sueldo Mariana" }).endsWith("sueldo Mariana"), "nota extra al final");
ok(notaLiteral({ ...base, concepto: "IVA TASA GENERAL", importe: -21, clasificacion: "impuesto", subtipo: "iva", nota: "IVA 21 %" }).split("IVA 21 %").length === 2, "no repite la nota si ya está");

ok(notaCobro({ cliente: "Soychu", facturas: "FA A 0008-00000660", neto: 1837080, retenciones: [{ tipo: "retencion_iva", monto: 178500, certificado: "34539" }, { tipo: "retencion_ganancias", monto: 29520, certificado: "46632" }, { tipo: "retencion_iibb", monto: 11900, certificado: "11438" }] })
  === "Cobro — Soychu — FA A 0008-00000660 — bruto $ 2.057.000,00 − Retención IVA $ 178.500,00 (certificado 34539) − Retención Ganancias $ 29.520,00 (certificado 46632) − Retención IIBB $ 11.900,00 (certificado 11438) = neto acreditado $ 1.837.080,00", "nota de cobro con 3 retenciones");

const a = armarCobroSistemaAnterior({ linea: { fecha: "2026-09-04", importe: 4001064.62 }, cliente: { id: "c1", nombre: "Termo Córdoba SAU" }, facturas: "FA A 0009-00000382 + FA A 0009-00000388", bruto: 4087799.99,
  retenciones: [{ tipo: "retencion_ganancias", monto: 63086.94, certificado: "000000002245" }, { tipo: "retencion_iibb", monto: 23648.43, certificado: "000000001090" }], referencia: "OP 000100015397" });
ok(a.diferencia === 0 && a.errores.length === 0, "sistema anterior: cierra exacto");
ok(a.movimientos[0].tipo === "transferencia" && a.movimientos[0].monto === 4001064.62 && a.movimientos.length === 3, "sistema anterior: transferencia primero + 2 retenciones");
ok(a.nota.includes("sistema anterior") && a.nota.includes("OP 000100015397") && a.nota.includes("banco 04/09"), "sistema anterior: nota literal");
const b = armarCobroSistemaAnterior({ linea: { fecha: "2026-09-04", importe: 1000 }, cliente: { id: "c1", nombre: "X" }, facturas: "FA 1", bruto: 1100, retenciones: [{ tipo: "retencion_iibb", monto: 50 }] });
ok(b.diferencia === 50 && b.nota.includes("no cierra por $ 50,00"), "sistema anterior: avisa diferencia");
ok(armarCobroSistemaAnterior({ linea: { fecha: "2026-09-04", importe: -5 }, cliente: { id: "", nombre: "" }, facturas: "", bruto: 0, retenciones: [] }).errores.length === 4, "sistema anterior: errores de datos");

console.log(fallas ? `\n${fallas} fallas` : "\nTodo OK");
process.exit(fallas ? 1 : 0);
