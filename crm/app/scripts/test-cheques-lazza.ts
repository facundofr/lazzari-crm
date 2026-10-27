import assert from "node:assert/strict";
import { coincideNumeroCheque, depositadoSegunBanco, rangoProximaSemana, enFecha, estaEnFecha, estadoCheque, opsDeCheques, ordenCheques, proximaSemana, proximasSemanas, resumenPorEstado, situacionPago, type ChequeFL } from "../src/lib/cheques-lazza";

const ch = (x: Partial<ChequeFL> & { id: string }): ChequeFL => ({ numero: x.id, direccion: "emitido", estado: "entregado", fecha_pago: "2026-10-19", monto: 100, moneda: "ARS", ...x });
const hoy = "2026-10-19"; // lunes

const cheques: ChequeFL[] = [
  ch({ id: "a", fecha_pago: "2026-10-17" }),                          // propio en fecha (vencido sin debitar)
  ch({ id: "b", fecha_pago: "2026-10-19", estado: "pendiente" }),     // propio en fecha hoy
  ch({ id: "c", fecha_pago: "2026-10-22" }),                          // semana 1
  ch({ id: "d", fecha_pago: "2026-10-27", monto: 50 }),               // semana 2
  ch({ id: "e", fecha_pago: "2026-11-16" }),                          // fuera de las 4 semanas
  ch({ id: "f", estado: "cobrado", fecha_pago: "2026-10-10" }),       // debitado: no cuenta
  ch({ id: "g", direccion: "recibido", estado: "en_cartera", fecha_pago: "2026-10-18", monto: 300 }), // para cobrar en fecha
  ch({ id: "h", direccion: "recibido", estado: "en_cartera", fecha_pago: "2026-11-09", monto: 70, moneda: "USD" }), // semana 4
  ch({ id: "i", direccion: "recibido", estado: "endosado", fecha_pago: "2026-10-20" }),
  ch({ id: "j", direccion: "recibido", estado: "rechazado" }),
];

assert.deepEqual(enFecha(cheques, hoy), { pagar: { cantidad: 2, ARS: 200, USD: 0 }, cobrar: { cantidad: 1, ARS: 300, USD: 0 }, depositados: { cantidad: 0, ARS: 0, USD: 0 } });
// 26/10/2026: en fecha solo hasta 30 días después de la fecha de pago
assert.equal(enFecha([ch({ id: "v", fecha_pago: "2026-09-19" })], hoy).pagar.cantidad, 1, "30 días justos: en fecha");
assert.equal(enFecha([ch({ id: "v", fecha_pago: "2026-09-18" })], hoy).pagar.cantidad, 0, "más de 30 días: ya no");
// Columna "Pago" (26/10/2026): en fecha hasta 30 días, después vencido; ni lo futuro ni lo ya debitado
assert.equal(situacionPago(ch({ id: "s1", fecha_pago: "2026-10-19" }), hoy), "en_fecha", "hoy");
assert.equal(situacionPago(ch({ id: "s2", fecha_pago: "2026-09-19" }), hoy), "en_fecha", "30 días justos");
assert.equal(situacionPago(ch({ id: "s3", fecha_pago: "2026-09-18" }), hoy), "vencido", "31 días");
assert.equal(situacionPago(ch({ id: "s4", fecha_pago: "2026-10-20" }), hoy), null, "todavía no llegó");
assert.equal(situacionPago(ch({ id: "s5", fecha_pago: "2026-09-01", estado: "cobrado" }), hoy), null, "ya debitado");
assert.equal(situacionPago(ch({ id: "s6", direccion: "recibido", estado: "en_cartera", fecha_pago: "2026-09-01" }), hoy), "vencido", "en cartera sin depositar a tiempo");
// Próxima semana: de mañana a 7 días
const ps = proximaSemana(cheques, hoy);
assert.deepEqual([ps.desde, ps.hasta], ["2026-10-20", "2026-10-26"]);
assert.deepEqual(ps.pagar, { cantidad: 1, ARS: 100, USD: 0 }, "el del 27/10 ya es la otra semana");
assert.equal(ps.cobrar.cantidad, 0, "el endosado no cuenta");

const sem = proximasSemanas(cheques, hoy);
assert.deepEqual(sem.map((s) => [s.desde, s.hasta]), [["2026-10-20", "2026-10-25"], ["2026-10-26", "2026-11-01"], ["2026-11-02", "2026-11-08"], ["2026-11-09", "2026-11-15"]]);
assert.deepEqual(sem.map((s) => s.pagar.ARS), [100, 50, 0, 0]);
assert.deepEqual(sem[3].cobrar, { cantidad: 1, ARS: 0, USD: 70 });
// Domingo: la 1ª semana arranca el lunes
assert.deepEqual(proximasSemanas([], "2026-10-25")[0], { desde: "2026-10-26", hasta: "2026-11-01", pagar: { cantidad: 0, ARS: 0, USD: 0 }, cobrar: { cantidad: 0, ARS: 0, USD: 0 } });

assert.equal(estadoCheque({ direccion: "emitido", estado: "cobrado" }).label, "Debitado");
assert.equal(estadoCheque({ direccion: "recibido", estado: "cobrado" }).label, "Cobrado");
const res = resumenPorEstado(cheques);
assert.deepEqual(res.map((r) => [r.label, r.total.cantidad]), [["Emitido sin debitar", 5], ["Debitado", 1], ["En cartera", 2], ["Endosado", 1], ["Rechazado", 1]]);

// ── Arreglo 19 (27/10/2026): lo que el banco ya tiene (depositado, presentado o en custodia) sale de "para depositar" ──
const rec = (x: Partial<ChequeFL> & { id: string }) => ch({ direccion: "recibido", estado: "en_cartera", fecha_pago: "2026-10-18", ...x });
for (const b of ["DEPOSITADO", "PRESENTADO", "CUSTODIA", " custodia "]) assert.equal(depositadoSegunBanco(rec({ id: "x", estadoBanco: b })), true, b);
assert.equal(depositadoSegunBanco(rec({ id: "x", estadoBanco: "ACTIVO" })), false, "ACTIVO: lo tenemos nosotros");
assert.equal(depositadoSegunBanco(rec({ id: "x", estadoBanco: "" })), false, "sin estado del banco");
assert.equal(depositadoSegunBanco(ch({ id: "x", estadoBanco: "CUSTODIA" })), false, "los propios no");
assert.equal(depositadoSegunBanco(rec({ id: "x", estado: "cobrado", estadoBanco: "DEPOSITADO" })), false, "ya cobrado: no está pendiente");
const conDepositados = [
  rec({ id: "d1", monto: 300 }),                                        // para depositar
  rec({ id: "d2", monto: 500, estadoBanco: "DEPOSITADO" }),             // ya depositado: aparte
  rec({ id: "d3", monto: 700, estadoBanco: "PRESENTADO", moneda: "USD" }),
  rec({ id: "d4", monto: 900, estadoBanco: "CUSTODIA", fecha_pago: "2026-10-22" }), // custodia con fecha futura: no está en fecha
];
assert.deepEqual(enFecha(conDepositados, hoy), { pagar: { cantidad: 0, ARS: 0, USD: 0 }, cobrar: { cantidad: 1, ARS: 300, USD: 0 }, depositados: { cantidad: 2, ARS: 500, USD: 700 } });
assert.deepEqual(conDepositados.filter((c) => estaEnFecha(c, hoy)).map((c) => c.id), ["d1"], "el filtro de la tarjeta, igual que la tarjeta");
assert.equal(situacionPago(conDepositados[1], hoy), "en_fecha", "la columna Pago no cambia: sigue pendiente hasta que se acredita");
assert.deepEqual(proximaSemana(conDepositados, hoy).cobrar, { cantidad: 1, ARS: 900, USD: 0 }, "a cobrar la semana que viene: sigue contando");

// Orden de la lista: pendientes del más cercano al más lejano (arriba lo en fecha); después el resto, del más nuevo al más viejo
const orden = [
  ch({ id: "o1", estado: "cobrado", fecha_pago: "2026-09-01" }),
  ch({ id: "o2", fecha_pago: "2026-12-30" }),
  ch({ id: "o3", direccion: "recibido", estado: "rechazado", fecha_pago: "2026-10-01" }),
  ch({ id: "o4", direccion: "recibido", estado: "en_cartera", fecha_pago: "2026-10-15" }),
  ch({ id: "o5", fecha_pago: "2026-10-21" }),
  ch({ id: "o6", estado: "anulado", fecha_pago: null }),
  ch({ id: "o7", estado: "cobrado", fecha_pago: "2026-10-10" }),
  ch({ id: "o8", fecha_pago: "2026-10-21", numero: "00001" }),
];
assert.deepEqual([...orden].sort(ordenCheques).map((c) => c.id), ["o4", "o8", "o5", "o2", "o7", "o3", "o1", "o6"]);

// ── Arreglo 20 (27/10/2026): en qué OP figura cada cheque ──
const ops = [
  { id: "op83", numero: "OP-000083", estado: "pagada", fecha: "2026-10-23", medios: [
    { tipo: "cheque_propio", numero_cheque: "90017399", monto: 1233290, echeq_id: null },
    { tipo: "cheque_propio", numero_cheque: "90017400", monto: 1233290, echeq_id: null },
  ] },
  { id: "op59", numero: "OP-000059", estado: "anulada", fecha: "2026-10-13", medios: JSON.stringify([{ tipo: "cheque_propio", numero_cheque: "90017380", monto: 1415000 }]) },
  { id: "op61", numero: "OP-000061", estado: "pagada", fecha: "2026-10-13", medios: [{ tipo: "cheque_propio", numero_cheque: "90017380", monto: "1415000" }] },
  { id: "op90", numero: "OP-000090", estado: "pagada", fecha: "2026-10-27", medios: [
    { tipo: "echeq", numero_cheque: "3587", monto: 1348076.59, echeq_id: "endosado" }, // endoso de cartera: con el id del cheque
    { tipo: "cheque", numero_cheque: "529", monto: 320000, echeq_id: null },
    { tipo: "transferencia", numero_cheque: "77", monto: 5000 },
  ] },
  // OP vieja (como la OP-000009): medios guardados como texto y los propios anotados como "echeq"
  { id: "op09", numero: "OP-000009", estado: "pagada", fecha: "2026-09-15", medios: JSON.stringify([
    { tipo: "echeq", numero_cheque: "00003414", monto: 12532078.86 },
    { tipo: "echeq", numero_cheque: "90017305", monto: 616690.29 },
  ]) },
];
const chq = [
  ch({ id: "p1", numero: "90017399", monto: 1233290 }),
  ch({ id: "p2", numero: "90017380", monto: 1415000 }),
  ch({ id: "p3", numero: "90017399", monto: 999 }),                                       // mismo N°, otro importe: no
  ch({ id: "p4", numero: "90017999", monto: 1000 }),                                      // en ninguna OP
  ch({ id: "endosado", direccion: "recibido", estado: "endosado", numero: "00099999", monto: 1 }), // por el id, aunque el N° no coincida
  ch({ id: "r529", direccion: "recibido", estado: "endosado", numero: "00000529", monto: 320000 }), // N° sin ceros + importe
  ch({ id: "t77", numero: "77", monto: 5000 }),                                           // una transferencia no es un cheque
  ch({ id: "v1", numero: "90017305", monto: 616690.29 }),                                 // propio en una OP vieja ("echeq", en texto)
  ch({ id: "v2", direccion: "recibido", estado: "endosado", numero: "3414", monto: 12532078.86 }), // endosado en la OP vieja
];
const porCheque = opsDeCheques(chq, ops);
assert.deepEqual(porCheque.get("p1")?.map((o) => o.numero), ["OP-000083"]);
assert.deepEqual(porCheque.get("p2")?.map((o) => [o.numero, o.anulada]), [["OP-000061", false], ["OP-000059", true]], "primero la vigente");
assert.equal(porCheque.has("p3"), false);
assert.equal(porCheque.has("p4"), false);
assert.deepEqual(porCheque.get("endosado")?.map((o) => o.numero), ["OP-000090"]);
assert.deepEqual(porCheque.get("r529")?.map((o) => o.numero), ["OP-000090"]);
assert.equal(porCheque.has("t77"), false);
assert.deepEqual(porCheque.get("v1")?.map((o) => o.numero), ["OP-000009"]);
assert.deepEqual(porCheque.get("v2")?.map((o) => o.numero), ["OP-000009"]);

// Buscar por N° de cheque: con o sin los ceros de adelante, solo números
assert.equal(coincideNumeroCheque(["90017399", "90017400"], "90017399"), true);
assert.equal(coincideNumeroCheque(["90017399"], "9001739"), true, "parte del N°");
assert.equal(coincideNumeroCheque(["00003587"], "3587"), true);
assert.equal(coincideNumeroCheque(["3587"], "00003587"), true);
assert.equal(coincideNumeroCheque(["90017399"], " 90017399 "), true);
assert.equal(coincideNumeroCheque(["90017399"], "OP-000083"), false, "no es un N° de cheque");
assert.equal(coincideNumeroCheque(["90017399"], ""), false);
assert.equal(coincideNumeroCheque([null, ""], "1"), false);
assert.equal(coincideNumeroCheque(["90017399"], "4019"), false);
assert.equal(coincideNumeroCheque(["4074"], "00000074"), false, "con ceros adelante es el N° entero, no una parte");
assert.equal(coincideNumeroCheque(["00000074"], "00000074"), true);
assert.equal(coincideNumeroCheque(["74"], "00000074"), true);
assert.equal(coincideNumeroCheque(["4074"], "74"), true, "sin ceros: parte del N°, como cualquier búsqueda");
assert.equal(coincideNumeroCheque(["00003587"], "0003587"), true);
assert.equal(coincideNumeroCheque(["3587"], "003587"), true);

// Una sola «próxima semana» (arreglo 10, 27/10/2026): de mañana a 7 días, la misma para el inicio y para Cheques
assert.deepEqual(rangoProximaSemana("2026-10-27"), { desde: "2026-10-28", hasta: "2026-11-03" });
{
  const p = proximaSemana([], "2026-10-27");
  assert.equal(p.desde, rangoProximaSemana("2026-10-27").desde);
  assert.equal(p.hasta, rangoProximaSemana("2026-10-27").hasta);
}

console.log("test-cheques-lazza OK");
