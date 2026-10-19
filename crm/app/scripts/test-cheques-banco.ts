import assert from "node:assert/strict";
import { compararConBanco, cuentasDeOtraSociedad, leerListadoBanco, tipoListado, type ChequeCrm } from "../src/lib/cheques-banco";

// Títulos tal cual vienen en los Excel del BBVA (19/10/2026).
const H_ACEPT = ["Emitido por", "Endosado por", "Banco emisor", "Fecha de emisión", "Fecha de Pago", "Fecha de vencimiento", "Monto", "CheqID", "N° de cheque", "Estado", "Tipo de Documento del Emisor", "CMC7", "GrupoID", "Endosos", "Cesiones"];
const H_DEP = ["Emitido por", "Endosado por", "Banco emisor", "Fecha de depósito", "Fecha de emisión", "Fecha de pago", "Fecha de vencimiento", "Monto", "CheqID", "N° de cheque", "N° de cuenta Desposito", "Estado", "Tipo de Documento del Emisor", "CMC7", "GrupoID", "Referencias", "Endosos"];
const H_END = ["Emitido por", "Endosado por", "Destinatario", "Banco emisor", "Fecha de Pago", "Fecha de vencimiento", "Fecha de emisión", "Monto", "CheqID", "N° de cheque", "N° de cuenta de emisión", "Estado", "Documento del Emisor", "CMC7", "Referencias", "Endosos", "GrupoID"];
const H_EMI = ["Emitido a", "Banco emisor", "Fecha de Pago", "Fecha de vencimiento", "Fecha de emisión", "Monto", "CheqID", "N° de cheque", "N° de cuenta de emisión", "Estado", "Tipo de Documento del Emisor", "CMC7", "Referencias", "Endosos", "GrupoID"];

assert.equal(tipoListado(H_ACEPT, "19-10-2026-eCheqs-aceptados.xls"), "aceptados");
assert.equal(tipoListado(H_ACEPT, "19-10-2026-eCheqs-rechazados.xls"), "rechazados");
assert.equal(tipoListado(H_DEP), "deposito");
assert.equal(tipoListado(H_END), "endosados");
assert.equal(tipoListado(H_EMI, "eCheqs-emitidos.xls"), "emitidos");
assert.equal(tipoListado(H_EMI, "eCheqs-denegados-salida.xls"), "denegados");
assert.equal(tipoListado(["Fecha", "Concepto", "Importe"]), null);

const acept = leerListadoBanco([H_ACEPT,
  ["DEL SOL CONSTRUCTORA SA", "--", "GALICIA", "04/09/2026", "30/10/2026", "28/11/2026", "$11801686.09", "x", "00003644", "ACTIVO", "30625547632", "", "0", "", ""],
  ["CLIENTE NUEVO SA", "--", "GALICIA", "16/10/2026", "30/11/2026", "", "$1000.0", "x", "00007777", "ACTIVO", "30111111118", "", "0", "", ""],
], "aceptados.xls");
assert.deepEqual([acept[0].numero, acept[0].monto, acept[0].pago, acept[0].cuit], ["00003644", 11801686.09, "2026-10-30", "30625547632"]);

const dep = leerListadoBanco([H_DEP,
  ["BARRAZA", "AUGUSTO LAZZARI", "GALICIA", "17/10/2026", "18/09/2026", "16/10/2026", "14/11/2026", "$10110492.35", "x", "00000131", "CC $ 091-312483/1", "DEPOSITADO", "27372557163", "", "0", "", ""],
  ["REBSA", "AUGUSTO LAZZARI", "PROVINCIA", "31/10/2026", "16/10/2026", "30/10/2026", "", "$1038632.84", "x", "11423615", "CC $ 091-312483/1", "PAGADO", "30711103747", "", "0", "", ""],
  ["VIEJO SA", "LAZZARI AUGUSTO", "MACRO", "29/05/2026", "21/05/2026", "21/05/2026", "", "$500893.3", "x", "91392311", "CC $ 091-312483/1", "PAGADO", "30715442872", "", "0", "", ""],
]);
assert.equal(dep[1].deposito, "2026-10-31");

const end = leerListadoBanco([H_END,
  ["TODD", "AUGUSTO LAZZARI", "BUENOS AIRES VALORES SA", "BPBA", "04/09/2026", "", "02/08/2026", "$794617.0", "x", "10569566", "", "PAGADO", "30716865963", "", "", "09/09/2026 Endosado por AUGUSTO LAZZARI CUIT - 20379309128|08/09/2026 Endosado por OTRO|", "0"],
  ["PUNTO", "AUGUSTO LAZZARI", "PROVEEDOR X SA", "GALICIA", "12/11/2026", "", "15/10/2026", "$1254607.86", "x", "00000231", "", "ACTIVO", "30718641329", "", "", "18/10/2026 Endosado por AUGUSTO LAZZARI CUIT - 20379309128|", "0"],
]);
assert.deepEqual([end[0].endoso, end[0].destinatario], ["2026-09-09", "BUENOS AIRES VALORES SA"]);

const rech = leerListadoBanco([H_ACEPT, ["BARRAZA", "AUGUSTO LAZZARI", "GALICIA", "25/09/2026", "01/10/2026", "", "$9220848.56", "x", "00000176", "RECHAZADO", "27372557163", "", "0", "", ""],
  ["REBSA", "AUGUSTO LAZZARI", "PROVINCIA", "16/10/2026", "15/11/2026", "", "$1038632.85", "x", "11423614", "RECHAZADO", "30711103747", "", "0", "", ""]], "rechazados.xls");

const emi = leerListadoBanco([H_EMI,
  ["SEGUTECNICA", "BBVA", "12/10/2026", "", "01/09/2026", "$3144953.35", "x", "90017283", "CC", "ACTIVO", "20379309128", "", "", "", "0"],
  ["FUJIWARA", "BBVA", "11/11/2026", "", "16/10/2026", "$750926.0", "x", "90017385", "CC", "PAGADO", "20379309128", "", "", "", "0"],
  ["OTRO", "BBVA", "11/11/2026", "", "16/10/2026", "$999.0", "x", "90017999", "CC", "PAGADO", "20379309128", "", "", "", "0"],
  ["MASTROIANNI", "BBVA", "31/10/2026", "", "09/09/2026", "$162750.06", "x", "90000170", "CC", "REPUDIADO", "20379309128", "", "", "", "0"],
], "denegados-salida.xls");
assert.deepEqual(emi.map((x) => x.listado), ["emitidos", "emitidos", "emitidos", "denegados"]); // decide el estado del banco, no el nombre del archivo

const emi2 = leerListadoBanco([H_EMI,
  ["SEGUTECNICA", "BBVA", "12/10/2026", "", "01/09/2026", "$3144953.35", "x", "90017283", "CC", "ACTIVO", "20379309128", "", "", "", "0"],
  ["FUJIWARA", "BBVA", "11/11/2026", "", "16/10/2026", "$750926.0", "x", "90017385", "CC", "PAGADO", "20379309128", "", "", "", "0"],
  ["OTRO", "BBVA", "11/11/2026", "", "16/10/2026", "$999.0", "x", "90017999", "CC", "PAGADO", "20379309128", "", "", "", "0"],
], "emitidos.xls");

const crm: ChequeCrm[] = [
  { id: "c3644", numero: "3644", direccion: "recibido", estado: "en_cartera", monto: 11801686.09, cuit_emisor: "30625547632" },
  { id: "c131", numero: "00000131", direccion: "recibido", estado: "depositado", monto: 10110492.35, cuit_emisor: "27372557163" },
  { id: "c15", numero: "11423615", direccion: "recibido", estado: "en_cartera", monto: 1038632.84, cuit_emisor: "30711103747" },
  { id: "c14", numero: "11423614", direccion: "recibido", estado: "en_cartera", monto: 1038632.85, cuit_emisor: "30711103747" },
  { id: "c566", numero: "10569566", direccion: "recibido", estado: "cobrado", monto: 794617, cuit_emisor: null },
  { id: "c231", numero: "00000231", direccion: "recibido", estado: "en_cartera", monto: 1254607.86, cuit_emisor: "30718641329" },
  { id: "c176", numero: "00000176", direccion: "recibido", estado: "rechazado", monto: 9220848.56, cuit_emisor: "27372557163" },
  { id: "e283", numero: "90017283", direccion: "emitido", estado: "entregado", monto: 3144953.35 },
  { id: "e385", numero: "90017385", direccion: "emitido", estado: "entregado", monto: 750926 },
  { id: "e999", numero: "90017999", direccion: "emitido", estado: "entregado", monto: 1000 },          // monto distinto
  { id: "x283", numero: "90017283", direccion: "emitido", estado: "anulado", monto: 3144953.35 },     // copia anulada: no cuenta
];

const r = compararConBanco([...acept, ...dep, ...end, ...rech, ...emi, ...emi2], crm);
const cambios = Object.fromEntries(r.cambios.map((c) => [c.chequeId, `${c.de}>${c.a}:${c.accion}`]));
assert.deepEqual(cambios, {
  c15: "en_cartera>cobrado:estado",      // depositado y pagado (la misma vez)
  c231: "en_cartera>endosado:estado",    // endosado a un proveedor fuera del CRM
  c14: "en_cartera>rechazado:rechazar",  // rechazado: usa la función de Finanzas
  e385: "entregado>cobrado:estado",      // el banco lo pagó: Debitado
});
assert.equal(r.cambios.find((c) => c.chequeId === "c15")!.campos.fecha_deposito, "2026-10-31");
assert.equal(r.cambios.find((c) => c.chequeId === "c231")!.campos.destino_nombre, "PROVEEDOR X SA");
assert.ok(r.avisos.some((a) => a.numero === "90017999" && /Monto distinto/.test(a.texto)));
// Faltan solo lo posterior al 22/08: el cliente nuevo; el repudiado de Mastroianni no está y es de 09/2026 → también figura
assert.deepEqual(r.faltan.map((f) => f.numero).sort(), ["00007777", "90000170"]);
assert.equal(r.viejos, 1); // el de mayo
// Coinciden: 3644 en cartera, 131 depositado, 10569566 cobrado en BAVSA, 176 rechazado, 90017283 activo
assert.equal(r.coinciden, 5);

// Excel de otra sociedad: las cuentas nuestras que traen (emisión / depósito) no son de la sociedad elegida
assert.equal(dep[0].cuentaPropia, "CC $ 091-312483/1");
assert.deepEqual(cuentasDeOtraSociedad([...dep, ...emi2], ["091-312483/1", "091-318933/7"]), []);
assert.deepEqual(cuentasDeOtraSociedad(dep, ["000-111111/1"]), ["CC $ 091-312483/1"]);
assert.deepEqual(cuentasDeOtraSociedad(acept, ["000-111111/1"]), []); // aceptados no traen cuenta: no se puede saber

console.log("test-cheques-banco OK");
