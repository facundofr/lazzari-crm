// Prueba rápida: npx tsx scripts/test-extracto-bbva.mjs
import assert from "node:assert/strict";
import {
  leerImporte, leerFecha, digitosCuenta, leerExtractoBbva, leerListadoCheques, chequesParaCompletar,
  cruzarExtracto, totalesBancoPorMes,
} from "../src/lib/extracto-bbva.ts";

// Importes y fechas en los formatos del banco y de la planilla.
assert.equal(leerImporte("-4.694.598,40"), -4694598.4);
assert.equal(leerImporte("21,00"), 21);
assert.equal(leerImporte("$90,750.00"), 90750);
assert.equal(leerImporte("$1,000,000.00"), 1000000);
assert.equal(leerImporte("$321517.45"), 321517.45);
assert.equal(leerImporte("1,000"), 1000);
assert.equal(leerImporte(""), null);
assert.equal(leerFecha("09/10/2026"), "2026-10-09");
assert.equal(digitosCuenta("091-312483/1"), digitosCuenta("CC$ 91-312483/1".replace(/^[A-Z$ ]+/i, "")));

// Excel del BBVA (de la más nueva a la más vieja).
const filas = [
  ["", "", "", "", ""],
  ["Detalle de Movimientos de Cuenta: CC$ 91-312483/1", "", "", "", ""],
  ["Fecha", "Concepto", "", "Importe", "Saldo"],
  ["09/10/2026", "Impuesto Ley 25.413", "91 - PERGAMINO", "-213,53", "11.030.415,82"],
  ["08/10/2026", "TRANSFERENCIA", "100 - BANCA ONLINE", "-5.870,42", "11.030.629,35"],
  ["31/08/2026", "PAGO CHEQUE 24HS 90017062", "91", "-100,00", "11.036.499,77"],
];
const ext = leerExtractoBbva(filas);
assert.equal(ext.cuentaDigitos, "913124831");
assert.equal(ext.lineas.length, 3);
assert.equal(ext.lineas[0].fecha, "2026-08-31");
assert.equal(ext.saldoFinal, 11030415.82);
assert.equal(ext.saldoFecha, "2026-10-09");
assert.equal(ext.saltos, 0);
const roto = leerExtractoBbva([...filas.slice(0, 3), filas[3], filas[5]]);
assert.equal(roto.saltos, 1, "si falta un renglón, el saldo no cierra");
assert.throws(() => leerExtractoBbva([["hola"]]));

// Planilla de cheques (hoja Emitidos) y Excel de eCheq emitidos.
const planilla = [
  ["Fecha emisión", "Fecha de cobro", "Monto", "Beneficiario", "N° cheque", "Estado", "Fecha débito", "Es Martín Fernández"],
  ["14/09/2022", "15/10/2022", "$90,750.00", "(sin nombre en planilla)", "90015547", "PAGADO", "18/10/2022", "No"],
  ["03/08/2026", "22/10/2026", "$3,478,818.67", "MARTIN FERNANDEZ", "90017186", "PENDIENTE", "", "Sí"],
  ["01/08/2026", "01/09/2026", "$507,863.65", "(sin nombre en planilla)", "90017010", "PAGADO", "01/09/2026", "No"],
];
const echeq = [
  ["Emitido a", "Banco emisor", "Fecha de Pago", "Fecha de vencimiento", "Fecha de emisión", "Monto", "CheqID", "N° de cheque", "N° de cuenta de emisión", "Estado"],
  ["PRISINA SA", "BBVA", "12/09/2026", "11/10/2026", "07/09/2026", "$5098651.44", "X", "90017270", "CC", "PAGADO"],
  ["MARTIN FERNANDEZ", "BBVA", "22/10/2026", "", "03/08/2026", "$3478818.67", "Y", "90017186", "CC", "ACTIVO"],
];
const lp = leerListadoCheques(planilla);
assert.equal(lp.length, 3);
assert.equal(lp[0].beneficiario, null);
assert.equal(lp[1].cubre_tercero, "Martín Fernández");
assert.equal(lp[1].monto, 3478818.67);
const le = leerListadoCheques(echeq);
assert.equal(le[0].beneficiario, "PRISINA SA");
assert.deepEqual(leerListadoCheques([["N° cheque", "Fecha de cobro", "Monto", "Estado"], ["1", "01/01/2026", "$1.0", "X"]]), [], "sin beneficiario no es listado de emitidos");
const completar = chequesParaCompletar([lp, le], "2026-08-01");
assert.deepEqual(completar.map((c) => c.numero), ["90017010", "90017270", "90017186"], "deja afuera lo viejo pagado y no repite");
assert.equal(completar.find((c) => c.numero === "90017186").cubre_tercero, "Martín Fernández", "el eCheq no le borra la marca de Martín");

// Cruce.
const cuentas = [
  { id: "cc", tipo: "cuenta_corriente", nombre: "BBVA CC EPP", numero: "091-312483/1", moneda: "ARS" },
  { id: "ca", tipo: "caja_ahorro", nombre: "BBVA CA $", numero: "091-339549/3", moneda: "ARS" },
  { id: "fci", tipo: "fci", nombre: "FCI", numero: "91-565772/5", moneda: "ARS" },
  { id: "visa", tipo: "tarjeta_credito", nombre: "BBVA Visa", numero: "0996722533", moneda: "ARS" },
  { id: "master", tipo: "tarjeta_credito", nombre: "BBVA Mastercard Black", numero: "1268315983", moneda: "ARS" },
  { id: "ef", tipo: "efectivo", nombre: "Efectivo", numero: null, moneda: "ARS" },
];
const L = (id, fecha, concepto, importe) => ({ id, fecha, concepto, importe, cuenta_id: "cc" });
const lineas = [
  L("iva", "2026-10-09", "IVA TASA GENERAL", -21),
  L("ley", "2026-10-08", "LEY NRO 25.413 SOBRE CREDIT", -4457.97),
  L("sir", "2026-10-08", "REG REC SIRCREB 07/10/26 00016X Nro:00000136", -17940.51),
  L("com", "2026-10-07", "COMI TRANSFERENCIA", -600),
  L("fci", "2026-10-01", "Operacion FCI Nro:123", 5000000),
  L("prop", "2026-09-25", "TRANSFERENCIA CAP091 339549 3 Nro:00010008", -6200000),
  L("ajena", "2026-09-30", "TRANSFERENCIA CAP170 350834 1 Nro:00010008", -7500000),
  L("visa", "2026-10-09", "CUENTA VISA NRO. 79099672253398", -4694598.4),
  L("mc", "2026-10-09", "CUENTA MASTERCARD NRO. 77126831598398", -3201710.17),
  L("ch1", "2026-09-01", "PAGO CHEQUE 48HS CAP.FED. N 90016949", -770203.87),
  L("ch2", "2026-09-25", "PAGO CHEQUE 48HS CAP.FED. N 00496366", -519477),
  L("dep", "2026-10-01", "DEPOSITO CHEQUE 48HS. Nro:09185339", 12532078.86),
  L("dev", "2026-10-06", "CHEQUE 48HS. DEVUELTO CAP F 00000074", -7623000),
  L("cob", "2026-10-02", "PAGO A PROVEEDORES OP.3406252", 1237419.65),
  L("t1", "2026-10-02", "TRANSFERENCIA 20372644606", -1500000),
  L("t2", "2026-10-02", "TRANSFERENCIA 27339634578", -1500000),
  L("dup1", "2026-09-10", "Transferencia inmediata", -400000),
  L("dup2", "2026-09-11", "Transferencia inmediata", -400000),
  L("rara", "2026-09-22", "PAGO DE SERVICIOS TARJETA 17779347 OP2194", -4439874.82),
  L("alesso", "2026-10-06", "DEPOSITO CHEQUE 48HS. Nro:62245658", 1000000),
];
const movs = [
  { id: "m-cob", tipo: "cobro", cliente_id: "c1", monto: 1237419.65, fecha: "2026-09-30", moneda: "ARS" },
  { id: "m-p1", tipo: "pago", proveedor_id: "p1", monto: 1500000, fecha: "2026-10-02", moneda: "ARS", cuit: "20-37264460-6" },
  { id: "m-p2", tipo: "pago", proveedor_id: "p2", monto: 1500000, fecha: "2026-10-02", moneda: "ARS", cuit: "27339634578" },
  { id: "m-d1", tipo: "pago", proveedor_id: "p3", monto: 400000, fecha: "2026-09-10", moneda: "ARS" },
  { id: "m-d2", tipo: "pago", proveedor_id: "p4", monto: 400000, fecha: "2026-09-11", moneda: "ARS" },
  { id: "m-anulado", tipo: "pago", proveedor_id: "p1", monto: 7500000, fecha: "2026-09-30", moneda: "ARS", anulado: true },
  { id: "m-ret", tipo: "retencion_ganancias", proveedor_id: "p1", monto: 21, fecha: "2026-10-09", moneda: "ARS" },
];
const cheques = [
  { id: "e1", numero: "90016949", monto: 770203.87, direccion: "emitido", estado: "entregado", fecha_pago: "2026-09-01" },
  { id: "e2", numero: "CHQ-ABC", monto: 519477, direccion: "emitido", estado: "entregado", fecha_pago: "2026-09-24" },
  { id: "r1", numero: "00003414", monto: 12532078.86, direccion: "recibido", estado: "depositado", fecha_pago: "2026-09-30" },
  { id: "r2", numero: "00000074", monto: 7623000, direccion: "recibido", estado: "rechazado", fecha_pago: "2026-10-05" },
];
const p = Object.fromEntries(cruzarExtracto(lineas, movs, cheques, cuentas).map((x) => [x.linea_id, x]));

assert.deepEqual([p.iva.clasificacion, p.iva.subtipo, p.iva.auto], ["impuesto", "iva", true]);
assert.equal(p.ley.subtipo, "ley_25413");
assert.equal(p.sir.subtipo, "sircreb");
assert.equal(p.com.clasificacion, "gasto_bancario");
assert.deepEqual([p.fci.clasificacion, p.fci.contra_cuenta_id, p.fci.auto], ["fci", "fci", true]);
assert.deepEqual([p.prop.clasificacion, p.prop.contra_cuenta_id], ["entre_cuentas", "ca"]);
assert.equal(p.ajena.clasificacion, "pago", "una cuenta que no es nuestra es un pago");
assert.equal(p.ajena.auto, false, "el pago anulado no sirve de candidato");
assert.deepEqual([p.visa.clasificacion, p.visa.contra_cuenta_id], ["tarjeta", "visa"]);
assert.equal(p.mc.contra_cuenta_id, "master");
assert.deepEqual([p.ch1.clasificacion, p.ch1.cheque_id, p.ch1.auto], ["cheque_emitido", "e1", true]);
assert.deepEqual([p.ch2.cheque_id, p.ch2.auto], ["e2", false], "cheque de papel sin número: se sugiere por importe, se pregunta");
assert.deepEqual([p.dep.clasificacion, p.dep.cheque_id, p.dep.auto], ["cheque_acreditado", "r1", true]);
assert.deepEqual([p.dev.clasificacion, p.dev.cheque_id, p.dev.auto], ["cheque_devuelto", "r2", true]);
assert.deepEqual([p.cob.clasificacion, p.cob.movimiento_id, p.cob.auto], ["cobro", "m-cob", true]);
assert.deepEqual([p.t1.movimiento_id, p.t2.movimiento_id], ["m-p1", "m-p2"], "mismo importe: desempata el CUIT");
assert.equal(p.dup1.auto, false, "dos pagos iguales sin CUIT: se pregunta");
assert.deepEqual(p.dup1.candidatos.sort(), ["m-d1", "m-d2"]);
assert.equal(p.rara.auto, false);
assert.deepEqual([p.alesso.clasificacion, p.alesso.auto], ["cheque_acreditado", false], "el cheque de Alesso no está en el CRM: se pregunta");

// Una regla "Recordar" gana sobre todo.
const conRegla = cruzarExtracto([lineas.find((l) => l.id === "rara")], [], [], cuentas, [{ texto: "pago de servicios tarjeta", sentido: "debito", clasificacion: "personal", nota: "Gastos personales" }]);
assert.deepEqual([conRegla[0].clasificacion, conRegla[0].auto], ["personal", true]);

// Un cheque ya enlazado no se vuelve a usar.
const yaUsado = cruzarExtracto([lineas.find((l) => l.id === "ch1")], [], cheques, cuentas, [], new Set(["cheque_emitido:e1"]));
assert.equal(yaUsado[0].auto, false);

// Línea marcada como "pago a cargar": se sigue buscando y cruza cuando aparece el pago.
const aCargar = cruzarExtracto([{ ...L("x", "2026-09-30", "TRANSFERENCIA", -7500000), clasificacion: "pago" }], [{ id: "nuevo", tipo: "pago", proveedor_id: "p9", monto: 7500000, fecha: "2026-09-30", moneda: "ARS" }], [], cuentas);
assert.deepEqual([aCargar[0].movimiento_id, aCargar[0].auto], ["nuevo", true]);

// Totales del banco por mes (1a).
const tot = totalesBancoPorMes([
  { fecha: "2026-10-09", importe: -21, clasificacion: "impuesto", subtipo: "iva" },
  { fecha: "2026-10-02", importe: -5900.82, clasificacion: "impuesto", subtipo: "iva" },
  { fecha: "2026-10-08", importe: 1829.52, clasificacion: "impuesto", subtipo: "ley_25413" },
  { fecha: "2026-09-01", importe: 35, clasificacion: "intereses", subtipo: "intereses" },
  { fecha: "2026-09-01", importe: -100, clasificacion: "pago", subtipo: null },
]);
assert.deepEqual(tot, { "2026-10": { iva: -5921.82, ley_25413: 1829.52 }, "2026-09": { intereses: 35 } });

// OP mixta (eCheq + transferencia): la línea del banco cruza con la parte en transferencia.
{
  const linea = { id: "mob", fecha: "2026-09-18", concepto: "TRANSFERENCIA 30715102001", importe: -527103.55, cuenta_id: "cc" };
  const mov = { id: "op22", tipo: "pago", proveedor_id: "p", fecha: "2026-09-18", monto: 1581310.65, montoCuenta: 527103.55, cuit: "30-71510200-1" };
  const [r] = cruzarExtracto([linea], [mov], [], cuentas);
  assert.equal(r.clasificacion, "pago");
  assert.equal(r.movimiento_id, "op22");
  assert.equal(r.auto, true);
}
// Extracción de efectivo: sale del banco pero no entra a la caja.
{
  const [r] = cruzarExtracto([{ id: "ext", fecha: "2026-09-25", concepto: "Extraccion de Efectivo Nro:00000001", importe: -6200000, cuenta_id: "ca" }], [], [], cuentas);
  assert.equal(r.clasificacion, "otro");
  assert.equal(r.subtipo, "extraccion_efectivo");
  assert.equal(r.contra_cuenta_id ?? null, null);
}


// Sin duplicar: la misma línea con otro texto (Excel "Movimientos" vs "Detalle_mov_cuenta") ya está cargada.
{
  const { lineasNuevas } = await import("../src/lib/extracto-bbva.ts");
  const cargadas = ["2026-10-09|-4694598.40|-1575636.31|CUENTA VISA NRO. 79099672253398"];
  const nuevas = lineasNuevas([
    { clave: "2026-10-09|-4694598.40|-1575636.31|PAGO VISA-IN 79099672253398" },
    { clave: "2026-10-13|3247761.58|-50000.00|DNET CREDITO" },
    { clave: "2026-10-13|3247761.58|-50000.00|DNET CREDITO · FUNDACION" },
  ], cargadas);
  assert.deepEqual(nuevas.map((l) => l.clave), ["2026-10-13|3247761.58|-50000.00|DNET CREDITO"]);
}

console.log("extracto-bbva OK");
