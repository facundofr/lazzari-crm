// Prueba rápida: npx tsx scripts/test-banco-motor.ts
import assert from "node:assert/strict";
import { cuitDeLinea, motorBanco, nombresDePersona, resumenMotor, type MovMotor } from "../src/lib/banco-motor";
import type { ChequeCruce, CuentaCruce, LineaCruce } from "../src/lib/extracto-bbva";

const EPP = "cta-epp";
const cuentas: CuentaCruce[] = [
  { id: EPP, tipo: "cuenta_corriente", nombre: "BBVA CC EPP LAZZARI", numero: "091-312483/1", moneda: "ARS" },
  { id: "cta-ca", tipo: "caja_ahorro", nombre: "BBVA Caja de ahorro $", numero: "091-339549/3", moneda: "ARS" },
  { id: "cta-fci", tipo: "fci", nombre: "BBVA FCI Money Market Pesos", numero: "91-565772/5", moneda: "ARS" },
  { id: "cta-bavsa", tipo: "fci", nombre: "BAVSA", numero: null, moneda: "USD" },
  { id: "cta-visa", tipo: "tarjeta_credito", nombre: "BBVA Visa Signature ·1582", numero: "0996722533", moneda: "ARS" },
  { id: "cta-master", tipo: "tarjeta_credito", nombre: "BBVA Mastercard Black ·4775", numero: "1268315983", moneda: "ARS" },
];
let n = 0;
const L = (fecha: string, importe: number, concepto: string): LineaCruce => ({ id: `l${++n}`, fecha, importe, concepto, cuenta_id: EPP });
const M = (id: string, fecha: string, monto: number, tipo: string, extra: Partial<MovMotor> = {}): MovMotor => ({ id, fecha, monto, tipo, moneda: "ARS", ...extra });
const correr = (lineas: LineaCruce[], movimientos: MovMotor[] = [], cheques: ChequeCruce[] = [], extra = {}) =>
  new Map(motorBanco({ lineas, movimientos, cheques, cuentas, ...extra }).map((d) => [d.linea_id, d]));

// 1. Impuestos, IVA, comisiones y SIRCREB por el código del banco: del banco (y la devolución también).
{
  const ls = [L("2026-10-26", -16526.65, "LEY NRO 25.4 23/10/26 00002 #609"), L("2026-10-26", -669.9, "IVA TASA GRA #236"),
    L("2026-10-26", -3190, "COMISION GES · CTE 000000089920 #392"), L("2026-10-26", -97117.69, "REG REC SIRC 23/10/26 00002X #550"),
    L("2026-10-05", 55325.09, "LEY NRO 25.413 SOBRE CREDIT #609")];
  const r = correr(ls);
  for (const l of ls) assert.equal(r.get(l.id)!.estado, "del_banco", l.concepto);
  assert.equal(r.get(ls[0].id)!.subtipo, "ley_25413");
  assert.equal(r.get(ls[4].id)!.subtipo, "devolucion_ley_25413");
  assert.equal(r.get(ls[2].id)!.clasificacion, "gasto_bancario");
}

// 2. FCI, tarjeta y pase entre cuentas propias: del banco con la cuenta del otro lado.
{
  const fci = L("2026-10-02", -5000000, "SUSCRIPCION FCI #654");
  const visa = L("2026-10-09", -4694598.4, "CUENTA VISA NRO. 79099672253398 #515");
  const master = L("2026-09-04", -4402026.27, "PAGO DE TARJETA MASTERCARD Nro:00312483 #743");
  const pase = L("2026-10-03", -500000, "TRANSFERENCIA CAP091 339549 3 #263");
  const r = correr([fci, visa, master, pase]);
  assert.deepEqual([r.get(fci.id)!.estado, r.get(fci.id)!.contra_cuenta_id], ["del_banco", "cta-fci"]);
  assert.deepEqual([r.get(visa.id)!.estado, r.get(visa.id)!.contra_cuenta_id], ["del_banco", "cta-visa"]);
  assert.deepEqual([r.get(master.id)!.estado, r.get(master.id)!.contra_cuenta_id], ["del_banco", "cta-master"]);
  assert.deepEqual([r.get(pase.id)!.estado, r.get(pase.id)!.contra_cuenta_id], ["del_banco", "cta-ca"]);
}

// 3. Transferencia que sale: importe exacto y único → cruzada con el pago (OP); sin pago → sin cruzar.
{
  const l = L("2026-10-26", -60500, "TRANSFERENCI 202530102618 · CTA.DESTINO #319");
  const sin = L("2026-10-27", -212950, "TRANSFERENCI 30999034515 #319");
  const r = correr([l, sin], [M("op92", "2026-10-25", 60500, "pago", { orden_pago_id: "OP-92", proveedor_id: "serger" })]);
  assert.deepEqual([r.get(l.id)!.estado, r.get(l.id)!.movimientos, r.get(l.id)!.clasificacion], ["cruzada", ["op92"], "pago"]);
  assert.equal(r.get(sin.id)!.estado, "sin_cruzar");
  assert.equal(r.get(sin.id)!.motivo, "No está el pago en el CRM");
}

// 4. El CUIT de la línea manda: con dos pagos iguales, gana el del proveedor de ese CUIT.
{
  const l = L("2026-10-14", -100000, "TRANSFERENCIA 20300773312 #319");
  const r = correr([l], [M("a", "2026-10-14", 100000, "pago", { proveedor_id: "p1", cuit: "20-30077331-2" }), M("b", "2026-10-14", 100000, "pago", { proveedor_id: "p2", cuit: "30-11111111-1" })]);
  assert.deepEqual(r.get(l.id)!.movimientos, ["a"]);
}

// 5. Dos pagos iguales de personas distintas y sin CUIT: no adivina.
{
  const l = L("2026-10-14", -100000, "Transferencia inmediata #129");
  const r = correr([l], [M("a", "2026-10-13", 100000, "pago", { proveedor_id: "p1" }), M("b", "2026-10-15", 100000, "pago", { proveedor_id: "p2" })]);
  assert.equal(r.get(l.id)!.estado, "sin_cruzar");
}

// 6. Varias líneas iguales contra varios pagos iguales de la MISMA OP: se aparean por fecha.
{
  const a = L("2026-10-10", -250000, "TRANSFERENCIA 30710000001 #319"), b = L("2026-10-11", -250000, "TRANSFERENCIA 30710000001 #319");
  const r = correr([a, b], [M("p1", "2026-10-10", 250000, "pago", { orden_pago_id: "OP-71" }), M("p2", "2026-10-11", 250000, "pago", { orden_pago_id: "OP-71" })]);
  assert.deepEqual([r.get(a.id)!.movimientos, r.get(b.id)!.movimientos], [["p1"], ["p2"]]);
}

// 7. Una transferencia que paga varios gastos de la misma persona (José 06/10: 303.048,74 + 150.000 + 106.951,26 = 560.000).
{
  const l = L("2026-10-06", -560000, "TRANSFERENCIA CAP091 071247 3 Nro:00010008 #265");
  const r = correr([l], [M("com", "2026-10-06", 303048.74, "pago", { texto: "Comisión septiembre 2026 — José Alvarez" }),
    M("int", "2026-10-06", 150000, "pago", { texto: "Interés préstamo José Alvarez — octubre 2026" }),
    M("via", "2026-10-06", 106951.26, "pago", { texto: "Viajes septiembre 2026 — José Alvarez" }), M("otro", "2026-10-06", 99999, "pago")]);
  assert.equal(r.get(l.id)!.estado, "cruzada");
  assert.deepEqual([...r.get(l.id)!.movimientos].sort(), ["com", "int", "via"]);
}

// 8. Una persona del equipo por su CUIT: cruza con sus gastos aunque haya otros pagos que sumen lo mismo.
{
  const l = L("2026-10-07", -589100, "TRANSFERENCIA 20372644606 #319");
  const r = correr([l], [M("prem", "2026-10-07", 400000, "pago", { texto: "Premio agosto — Jerónimo Casadidio" }), M("mono", "2026-10-07", 61100, "pago", { texto: "Monotributo — Jerónimo Casadidio" }),
    M("mut", "2026-10-07", 128000, "pago", { texto: "Mutual — Jerónimo Casadidio" }), M("mutm", "2026-10-07", 128000, "pago", { texto: "Mutual — Mariana Santinelli" })]);
  assert.deepEqual([...r.get(l.id)!.movimientos].sort(), ["mono", "mut", "prem"]);
}

// 9. Cobro que entra, la parte en transferencias de un pago de OP, y un desatado a mano que no se vuelve a cruzar.
{
  const cob = L("2026-10-29", 379888.75, "PAGO A PROVEEDORES OP.2619840 #983");
  const op = L("2026-10-20", -1617000, "TRANSFERENCIA 30708811994 #319");
  const r = correr([cob, op], [M("cg", "2026-10-29", 379888.75, "cobro", { cliente_id: "cargill" }), M("opm", "2026-10-19", 2000000, "pago", { montoCuenta: 1617000, orden_pago_id: "OP-61" })]);
  assert.deepEqual([r.get(cob.id)!.movimientos, r.get(cob.id)!.clasificacion], [["cg"], "cobro"]);
  assert.deepEqual(r.get(op.id)!.movimientos, ["opm"]);
  const r2 = correr([cob], [M("cg", "2026-10-29", 379888.75, "cobro", { cliente_id: "cargill" })], [], { prohibidos: new Set([`${cob.id}|cg`]) });
  assert.equal(r2.get(cob.id)!.estado, "sin_cruzar");
  const r3 = correr([cob], [M("cg", "2026-10-29", 379888.75, "cobro")], [], { prohibidos: new Set([`${cob.id}|*`]) });
  assert.equal(r3.has(cob.id), false);
}

// 10. VEP (código 137): cruza con el pago del gasto de Impuestos y queda como impuesto de ARCA.
{
  const l = L("2026-10-21", -677120.73, "PAGO DE SERVICIOS TARJETA 17779347 OP5532 #137");
  const r = correr([l], [M("vep", "2026-10-21", 677120.73, "pago", { texto: "SICORE octubre 2026" })]);
  assert.deepEqual([r.get(l.id)!.estado, r.get(l.id)!.clasificacion, r.get(l.id)!.subtipo, r.get(l.id)!.movimientos], ["cruzada", "impuesto", "afip", ["vep"]]);
  const sinVep = correr([L("2026-10-21", -5000, "PAGO DE SERVICIOS TARJETA 17779347 OP1 #137")]);
  assert.equal([...sinVep.values()][0].motivo, "VEP sin cargar en Gastos");
}

// 11. Cheques: propio debitado por N°, propio sin N° por importe, depósito, y cheque de papel rechazado (se rechaza y avisa).
{
  const cheques: ChequeCruce[] = [
    { id: "ch1", numero: "90017344", monto: 300000, direccion: "emitido", estado: "entregado", fecha_pago: "2026-10-20" },
    { id: "ch2", numero: "123", monto: 75000, direccion: "emitido", estado: "entregado", fecha_pago: "2026-10-01" },
    { id: "ch3", numero: "48", monto: 290000, direccion: "recibido", estado: "en_cartera", fecha_pago: "2026-10-24" },
    { id: "ch4", numero: "131", monto: 266000, direccion: "recibido", estado: "depositado", fecha_pago: "2026-10-10", tipo_cheque: "fisico", origen_nombre: "Barraza" },
  ];
  const debito = L("2026-10-21", -300000, "CH/CLEAR.48 · N 90017344 #005");
  const sinN = L("2026-10-02", -75000, "CJE. INTERNO #016");
  const dep = L("2026-10-26", 290000, "DEPOS.CHQ.48 C.F.U.62249803 #082");
  const rech = L("2026-10-14", -266000, "DEVUELTO CAP F · N 131 #019");
  const r = correr([debito, sinN, dep, rech], [], cheques);
  assert.deepEqual([r.get(debito.id)!.estado, r.get(debito.id)!.cheque_id], ["cruzada", "ch1"]);
  assert.deepEqual([r.get(sinN.id)!.estado, r.get(sinN.id)!.cheque_id], ["cruzada", "ch2"]);
  assert.deepEqual([r.get(dep.id)!.estado, r.get(dep.id)!.cheque_id], ["cruzada", "ch3"]);
  assert.deepEqual([r.get(rech.id)!.estado, r.get(rech.id)!.cheque_id, r.get(rech.id)!.rechazar_cheque], ["cruzada", "ch4", true]);
  assert.match(r.get(rech.id)!.aviso || "", /Barraza/);
  assert.deepEqual(resumenMotor([...r.values()]), { cruzadas: 4, delBanco: 0, sinCruzar: 0 });
}

// 12. La línea trae el CUIT de otro proveedor: no se cruza sola aunque el importe sea exacto y único (Augusto 30/10).
//     Un N° de cuenta de 11 dígitos no es un CUIT (Synthon 22/10).
{
  const otro = L("2026-10-20", -150000, "TRANSFERENCIA 30506792165 #319");
  const cuenta = L("2026-10-22", 60773.05, "DNET CREDITO NE4053216 · CTE 053216 072-00000946135 SYNTHON ARG TRAN #");
  const r = correr([otro, cuenta], [M("pg", "2026-10-20", 150000, "pago", { proveedor_id: "p9", cuit: "30-57730987-2" }),
    M("sy", "2026-10-22", 60773.05, "cobro", { cliente_id: "synthon", cuit: "30577309872" })]);
  assert.equal(r.get(otro.id)!.estado, "sin_cruzar");
  assert.match(r.get(otro.id)!.motivo, /otro CUIT/);
  assert.deepEqual(r.get(cuenta.id)!.movimientos, ["sy"]);
  assert.equal(cuitDeLinea("TRANSFERENCIA 30506792165 #319"), "30506792165");
  assert.equal(cuitDeLinea("CTE 053216 072-00000946135"), null);
}

// 13. Varios movimientos que suman exacto: solo si son del mismo cliente, proveedor o persona (Augusto 30/10).
{
  const l = L("2026-10-15", -300000, "Transferencia inmediata #129");
  const r = correr([l], [M("a", "2026-10-15", 100000, "pago", { proveedor_id: "p1" }), M("b", "2026-10-15", 200000, "pago", { proveedor_id: "p2" })]);
  assert.equal(r.get(l.id)!.estado, "sin_cruzar");
  assert.match(r.get(l.id)!.motivo, /distintos/);
  const r2 = correr([l], [M("a", "2026-10-15", 100000, "pago", { proveedor_id: "p1" }), M("b", "2026-10-15", 200000, "pago", { proveedor_id: "p1" })]);
  assert.deepEqual([...r2.get(l.id)!.movimientos].sort(), ["a", "b"]);
  assert.deepEqual(nombresDePersona("Comisión septiembre 2026 — José Alvarez"), ["jose alvarez"]);
  assert.deepEqual(nombresDePersona("Interés préstamo José Alvarez — octubre 2026"), []);
}

// 14. Cheque rechazado que no se resuelve solo: el propio y el que no se sabe cuál es van a la campana; el eCheq recibido no
//     (lo rechaza el reporte de eCheq de rechazados, que deja su propio aviso).
{
  const cheques: ChequeCruce[] = [
    { id: "e1", numero: "777", monto: 50000, direccion: "emitido", estado: "entregado", fecha_pago: "2026-10-10" },
    { id: "r1", numero: "555", monto: 80000, direccion: "recibido", estado: "depositado", fecha_pago: "2026-10-10", tipo_cheque: "echeq" },
  ];
  const propio = L("2026-10-14", -50000, "DEVUELTO CAP F · N 777 #019");
  const echeq = L("2026-10-14", -80000, "DEVUELTO CAP F · N 555 #019");
  const nose = L("2026-10-14", -12345, "DEVUELTO CAP F · N 999 #019");
  const r = correr([propio, echeq, nose], [], cheques);
  for (const l of [propio, echeq, nose]) assert.equal(r.get(l.id)!.estado, "sin_cruzar", l.concepto);
  assert.match(r.get(propio.id)!.aviso || "", /14\/10 por \$ 50\.000,00: .*PROPIO/);
  assert.equal(r.get(echeq.id)!.aviso, undefined);
  assert.ok(r.get(nose.id)!.aviso);
}

console.log("test-banco-motor OK");
