// Prueba rápida: npx tsx scripts/test-tablero-inicio.ts
import assert from "node:assert/strict";
import type { FilaVencimiento } from "../src/lib/finanzas-lazza";
import {
  agendaSemana, chequesPorDia, frasesInicio, listaDias, mayorVencido, pesosCorto, plazosCheques, plazosFacturas, semanasTablero,
  type ChequeTablero, type Parte,
} from "../src/lib/tablero-inicio";

const HOY = "2026-11-02"; // lunes
const DOLAR = 1534;
const texto = (f: Parte[]) => f.map((p) => (typeof p === "string" ? p : p.fuerte)).join("");

// 1. Semanas: esta (de hoy al domingo) y las 3 siguientes, de lunes a domingo; un domingo, hasta el domingo que viene.
const sem = semanasTablero(HOY);
assert.deepEqual(sem, [
  { desde: "2026-11-02", hasta: "2026-11-08" }, { desde: "2026-11-09", hasta: "2026-11-15" },
  { desde: "2026-11-16", hasta: "2026-11-22" }, { desde: "2026-11-23", hasta: "2026-11-29" },
]);
assert.deepEqual(semanasTablero("2026-11-05")[0], { desde: "2026-11-05", hasta: "2026-11-08" }, "un jueves: de hoy al domingo");
assert.deepEqual(semanasTablero("2026-11-08")[0], { desde: "2026-11-08", hasta: "2026-11-15" }, "un domingo: hasta el domingo que viene");

// 2. A cobrar y a pagar por plazo, todo en pesos (los dólares al dólar del día).
const F = (lado: "venta" | "compra", vence: string, saldo: number, moneda: "ARS" | "USD" = "ARS", nombre = "X", entidadId = nombre): FilaVencimiento => ({
  lado, id: `${lado}-${vence}-${saldo}`, entidadId, fecha: "2026-10-01", vence, sinVencimiento: false, comprobante: "FA 15-1", nombre, moneda, total: saldo, saldo, dias: 0,
});
const filas: FilaVencimiento[] = [
  F("venta", "2026-10-20", 1_000_000, "ARS", "Cliente A"), F("venta", "2026-10-25", 2_000, "USD", "Cliente B"),
  F("venta", "2026-11-02", 500_000, "ARS", "Cliente C"), F("venta", "2026-11-05", 1_000, "USD", "Cliente D"),
  F("venta", "2026-11-18", 300_000), F("venta", "2026-12-15", 700_000), F("venta", "2026-11-10", 0),
  F("compra", "2026-10-30", 400_000, "ARS", "Proveedor A"), F("compra", "2026-11-04", 250_000, "ARS", "Proveedor B"),
];
const cobrar = plazosFacturas(filas, "venta", HOY, DOLAR, sem);
assert.equal(cobrar.vencido, 1_000_000 + 2_000 * DOLAR, "vencido: lo que vencía antes de hoy, con los dólares en pesos");
assert.deepEqual(cobrar.semanas, [500_000 + 1_000 * DOLAR, 0, 300_000, 0], "hoy cuenta en esta semana");
assert.equal(cobrar.despues, 700_000);
assert.equal(cobrar.total, cobrar.vencido + cobrar.semanas.reduce((a, b) => a + b, 0) + cobrar.despues, "el total es la suma de los plazos");
assert.equal(cobrar.usd, 3_000, "dólares incluidos, en dólares");
assert.equal(cobrar.cantidad, 6, "una factura sin saldo no cuenta");
const pagar = plazosFacturas(filas, "compra", HOY, DOLAR, sem);
assert.equal(pagar.vencido, 400_000);
assert.equal(pagar.semanas[0], 250_000);
assert.equal(plazosFacturas(filas, "venta", HOY, null, sem).usd, 3_000, "sin dólar del día los dólares no pasan a pesos, pero se cuentan");

// 3. Cheques propios a cubrir: en fecha (hasta 30 días) cuenta esta semana; vencido hace más de 30 días, debitado o recibido, no.
const C = (id: string, fecha_pago: string, monto: number, estado = "entregado", direccion = "emitido", destino_nombre = "Proveedor"): ChequeTablero =>
  ({ id, numero: id, monto, moneda: "ARS", fecha_pago, estado, direccion, destino_nombre });
const cheques = [
  C("enfecha", "2026-10-28", 100_000), C("vencido", "2026-09-20", 999_999), C("mie", "2026-11-04", 3_500_000),
  C("vie", "2026-11-06", 3_900_000), C("prox", "2026-11-12", 5_100_000), C("lejos", "2026-12-20", 2_000_000),
  C("debitado", "2026-11-04", 777_777, "cobrado"), C("anulado", "2026-11-04", 888_888, "anulado"), C("recibido", "2026-11-04", 666_666, "en_cartera", "recibido"),
];
const ch = plazosCheques(cheques, HOY, DOLAR, sem);
assert.deepEqual(ch.semanas, [100_000 + 3_500_000 + 3_900_000, 5_100_000, 0, 0]);
assert.equal(ch.despues, 2_000_000);
assert.equal(ch.vencido, 0, "los cheques no tienen vencido: en fecha se cubren esta semana");
assert.equal(ch.cantidad, 5);
const dias = chequesPorDia(cheques, HOY, DOLAR, sem[0]);
assert.equal(dias.length, 7);
assert.deepEqual(dias.filter((d) => d.cantidad).map((d) => [d.fecha, d.pesos]), [["2026-11-02", 100_000], ["2026-11-04", 3_500_000], ["2026-11-06", 3_900_000]], "el que está en fecha, hoy");

// 4. Agenda de esta semana: por fecha; sin lo vencido; el cheque en fecha, hoy.
const ag = agendaSemana(filas, cheques, HOY, DOLAR, sem[0]);
assert.deepEqual(ag.map((a) => [a.fecha, a.tipo]), [
  ["2026-11-02", "cobro"], ["2026-11-02", "cheque"], ["2026-11-04", "cheque"], ["2026-11-04", "pago"], ["2026-11-05", "cobro"], ["2026-11-06", "cheque"],
]);
assert.equal(ag[1].enFechaDesde, "2026-10-28");
assert.equal(ag[1].cantidad, 1);
assert.equal(ag[1].detalle, "Cheque enfecha");
assert.equal(ag[4].usd, 1_000);
assert.equal(ag[4].pesos, 1_000 * DOLAR);
// Los cheques del mismo día y del mismo destinatario, en un renglón (los en fecha van a hoy, con la fecha más vieja).
const star = [C("s1", "2026-10-31", 884_000, "entregado", "emitido", "STAR TEX S A"), C("s2", "2026-10-30", 884_000, "entregado", "emitido", "Star Tex S A"),
  C("s3", "2026-11-04", 500_000, "entregado", "emitido", "STAR TEX S A"), C("p1", "2026-10-31", 300_000, "entregado", "emitido", "PRISINA SA")];
const agS = agendaSemana([], star, HOY, DOLAR, sem[0]);
assert.deepEqual(agS.map((a) => [a.fecha, a.nombre, a.cantidad, a.pesos, a.detalle, a.enFechaDesde ?? null]), [
  ["2026-11-02", "STAR TEX S A", 2, 1_768_000, "2 cheques", "2026-10-30"], ["2026-11-02", "PRISINA SA", 1, 300_000, "Cheque p1", "2026-10-31"],
  ["2026-11-04", "STAR TEX S A", 1, 500_000, "Cheque s3", null],
]);

// 5. Textos.
assert.equal(pesosCorto(3_215_000), "$ 3,2 M");
assert.equal(pesosCorto(12_000_000), "$ 12 M");
assert.equal(pesosCorto(950_400), "$ 950 mil");
assert.equal(pesosCorto(999_960), "$ 1 M");
assert.equal(pesosCorto(197.26), "$ 197");
assert.equal(listaDias(["2026-11-06", "2026-11-04", "2026-11-04"], HOY), "miércoles y viernes");
assert.equal(listaDias(["2026-11-02"], HOY), "hoy");
assert.equal(listaDias(["2026-11-02", "2026-11-03", "2026-11-06"], HOY), "hoy, martes y viernes");
assert.deepEqual(mayorVencido(filas, HOY, DOLAR), { nombre: "Cliente B", pesos: 2_000 * DOLAR }, "en pesos, el de dólares es el más grande");

const fr = frasesInicio({
  hoy: HOY, facturado: 3_200_000, facturadoAnterior: 2_500_000, objetivo: 120_000_000,
  cheques: { cantidad: 3, pesos: 7_500_000, fechas: ["2026-11-02", "2026-11-04", "2026-11-06"] }, pagosSemana: 250_000,
  vencidoCobrar: 4_068_000, mayorVencido: { nombre: "Cliente B", pesos: 3_068_000 },
}).map(texto);
assert.deepEqual(fr, [
  "Noviembre arrancó con $ 3,2 M facturados.",
  "Esta semana hay que cubrir 3 cheques por $ 7,5 M (hoy, miércoles y viernes) y vencen $ 250 mil de pagos.",
  "Para cobrar hay $ 4,1 M vencidos: lo más grande es Cliente B ($ 3,1 M).",
]);
const fr2 = frasesInicio({
  hoy: "2026-11-20", facturado: 60_000_000, facturadoAnterior: 59_000_000, objetivo: 120_000_000,
  cheques: { cantidad: 0, pesos: 0, fechas: [] }, pagosSemana: 0, vencidoCobrar: 0, mayorVencido: null,
}).map(texto);
assert.deepEqual(fr2, [
  "En noviembre llevás $ 60 M facturados, el 50 % del objetivo, parecido a octubre a esta altura.",
  "Esta semana no hay cheques para cubrir ni pagos que venzan.",
  "No hay nada vencido para cobrar.",
]);
const sinFacturas = { hoy: HOY, facturado: 0, facturadoAnterior: 12_400_000, objetivo: 120_000_000, cheques: { cantidad: 0, pesos: 0, fechas: [] }, pagosSemana: 0, vencidoCobrar: 0, mayorVencido: null };
assert.equal(texto(frasesInicio(sinFacturas)[0]), "Noviembre todavía no tiene facturas.", "el mes sin facturas no se compara");
assert.equal(texto(frasesInicio({ ...sinFacturas, hoy: "2026-11-12", facturado: 30_000_000, facturadoAnterior: 40_000_000 })[0]),
  "En noviembre llevás $ 30 M facturados, el 25 % del objetivo, menos que octubre a esta altura ($ 40 M).", "desde el día 8 se compara");
assert.equal(frasesInicio({ hoy: HOY, facturado: null, facturadoAnterior: null, objetivo: null, cheques: { cantidad: 1, pesos: 5, fechas: ["2026-11-03"] }, pagosSemana: 0, vencidoCobrar: 0, mayorVencido: null }).length, 2, "sin facturado, no hay frase del mes");

console.log("test-tablero-inicio OK");
