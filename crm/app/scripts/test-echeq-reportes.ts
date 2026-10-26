// Prueba rápida: npx tsx scripts/test-echeq-reportes.ts
import assert from "node:assert/strict";
import { leerReporteEcheq, tipoDeNombreEcheq, armarItemsEcheq, TOPE_EMITIDOS } from "../src/lib/echeq-reportes";

// Nombres
assert.equal(tipoDeNombreEcheq("23-10-2026-eCheqs-aceptados.xls"), "aceptados");
assert.equal(tipoDeNombreEcheq("22-10-2026-eCheqs-denegados-salida (1).xls"), "denegados-salida");
assert.equal(tipoDeNombreEcheq("22-10-2026-eCheqs-caducados-salida.xls"), "caducados-salida");
assert.equal(tipoDeNombreEcheq("23-10-2026-eCheqs-cedidos.xls"), "cedidos");
assert.equal(tipoDeNombreEcheq("Movimientos (25).xls"), null);

const ENC_REC = ["Emitido por", "Endosado por", "Banco emisor", "Fecha de emisión", "Fecha de Pago", "Fecha de vencimiento", "Monto", "CheqID", "N° de cheque", "Estado", "Tipo de Documento del Emisor"];
const rec = (por: string, id: string, num: string, monto: string, banco = "BANCO GALICIA", estado = "ACTIVO") => [por, "--", banco, "23/10/2026", "30/12/2026", "28/01/2027", monto, id, num, estado, "30625547632"];

// Recibidos: lee CheqID, número con ceros, monto "$3241696.55", fechas ISO, "--" → vacío
let r = leerReporteEcheq([ENC_REC, rec("DEL SOL SA", "EZ8NPV1YE34N4KV", "00004074", "$3241696.55")], "23-10-2026-eCheqs-aceptados.xls");
assert.equal(r.direccion, "recibido"); assert.equal(r.tipo, "aceptados"); assert.deepEqual(r.advertencias, []);
assert.equal(r.filas.length, 1);
assert.equal(r.filas[0].cheqId, "EZ8NPV1YE34N4KV"); assert.equal(r.filas[0].numero, "00004074"); assert.equal(r.filas[0].monto, 3241696.55);
assert.equal(r.filas[0].estadoBanco, "ACTIVO"); assert.equal(r.filas[0].fechaPago, "2026-12-30"); assert.equal(r.filas[0].endosadoPor, ""); assert.equal(r.filas[0].contraparte, "DEL SOL SA");

// Emitidos: "Emitido a"
const ENC_EMI = ["Emitido a", "Banco emisor", "Fecha de Pago", "Fecha de vencimiento", "Fecha de emisión", "Monto", "CheqID", "N° de cheque", "N° de cuenta de emisión", "Estado"];
r = leerReporteEcheq([ENC_EMI, ["VECHER SA", "BANCO BBVA ARGENTINA S.A.", "30/11/2026", "29/12/2026", "23/10/2026", "$100000.0", "RZP90RK0D8Y2EGJ", "90017418", "CC $ 091-312483/1", "EMITIDO_PENDIENTE"]], "23-10-2026-eCheqs-emitidos.xls");
assert.equal(r.direccion, "emitido"); assert.equal(r.filas[0].estadoBanco, "EMITIDO_PENDIENTE"); assert.equal(r.filas[0].monto, 100000); assert.deepEqual(r.advertencias, []);

// Nombre y columnas no coinciden → avisa (no bloquea, igual lee)
r = leerReporteEcheq([ENC_REC, rec("DEL SOL SA", "A1", "1", "$10")], "23-10-2026-eCheqs-emitidos.xls");
assert.equal(r.filas.length, 1); assert.ok(r.advertencias.some((a) => /nombre dice "emitidos"/.test(a)));

// No es un reporte de eCheq (un Excel de Movimientos)
r = leerReporteEcheq([["Fecha", "Fecha Valor", "Concepto", "Codigo"]], "Movimientos (25).xls");
assert.equal(r.filas.length, 0); assert.equal(r.direccion, null); assert.ok(r.advertencias[0].startsWith("No parece un reporte de eCheq"));

// Mismo N° con distinto CheqID (distinto banco): avisa; mismo CheqID dos veces: avisa
r = leerReporteEcheq([ENC_REC, rec("A", "ID1", "12345", "$100", "BANCO GALICIA"), rec("B", "ID2", "00012345", "$200", "CREDICOOP"), rec("C", "ID3", "999", "$5"), rec("C", "ID3", "999", "$5")], "x-eCheqs-aceptados.xls");
assert.ok(r.advertencias.some((a) => /N° de cheque 12345 aparece 2 veces con distinto CheqID/.test(a)));
assert.ok(r.advertencias.some((a) => /CheqID ID3 está 2 veces/.test(a)));
assert.equal(r.filas.length, 4);

// Filas incompletas se avisan y no se leen
r = leerReporteEcheq([ENC_REC, rec("A", "", "5", "$1"), rec("B", "ID9", "6", "")], "x-eCheqs-aceptados.xls");
assert.equal(r.filas.length, 0); assert.equal(r.advertencias.length, 2);

// Exactamente 100 emitidos: puede estar cortado
const cien = Array.from({ length: TOPE_EMITIDOS }, (_, i) => ["P", "BANCO BBVA", "30/11/2026", "29/12/2026", "23/10/2026", "$1", `ID${i}`, String(1000 + i), "CC", "ACTIVO"]);
r = leerReporteEcheq([ENC_EMI, ...cien], "23-10-2026-eCheqs-emitidos.xls");
assert.equal(r.filas.length, 100); assert.ok(r.advertencias.some((a) => /puede estar cortado/.test(a)));
r = leerReporteEcheq([ENC_EMI, ...cien.slice(0, 99)], "23-10-2026-eCheqs-emitidos.xls");
assert.deepEqual(r.advertencias, []);

// armarItemsEcheq: une los reportes de una carga; el mismo CheqID con estados distintos no se aplica (se avisa)
{
  const rA = leerReporteEcheq([ENC_REC, rec("A", "ID1", "1", "$10", "BANCO GALICIA", "ACTIVO"), rec("B", "ID2", "2", "$20")], "x-eCheqs-aceptados.xls");
  const rB = leerReporteEcheq([ENC_REC, rec("A", "ID1", "1", "$10", "BANCO GALICIA", "PAGADO"), rec("C", "ID3", "3", "$30", "BANCO GALICIA", "PAGADO")], "x-eCheqs-deposito.xls");
  const rC = leerReporteEcheq([ENC_REC, rec("B", "ID2", "2", "$20")], "x-eCheqs-endosados.xls"); // mismo estado: se aplica una vez
  const u = armarItemsEcheq([rA, rB, rC]);
  assert.deepEqual(u.items.map((i) => i.cheq_id).sort(), ["ID2", "ID3"]);
  assert.equal(u.avisos.length, 1); assert.ok(/ID1/.test(u.avisos[0]));
  assert.equal(u.items.find((i) => i.cheq_id === "ID3")!.direccion, "recibido");
}

console.log("test-echeq-reportes OK");
