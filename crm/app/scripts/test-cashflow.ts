// Prueba de lib/cashflow.ts (Cashflow semanal: real del banco + 12 semanas proyectadas) — npx tsx scripts/test-cashflow.ts
import assert from "node:assert/strict";
import { armarCashflow, cierreDelDia, filaDeGasto, filaDeLineaBanco, flujo, fotoDelMes, planillaCF, proyeccionCF, saldoAlArrancar, totalEntra, totalSale, type LineaBancoCF } from "../src/lib/cashflow";

// ── A qué fila va cada cosa ──
const gasto = (grupo: string, categoria: string, descripcion: string) => filaDeGasto({ grupo, categoria, descripcion });
assert.equal(gasto("Personal", "Sueldos", "Sueldo Mariana Santinelli"), "sueldos");
assert.equal(gasto("Premios", "Premios", "Premio agosto — Jerónimo Casadidio"), "sueldos");
assert.equal(gasto("Personal", "Comisiones", "Comisión septiembre 2026 — José Alvarez"), "sueldos");
assert.equal(gasto("Impuestos", "Impuestos", "ARBA plan de pagos web AA544RB 780101"), "retiros", "el plan de ARBA es de Augusto");
assert.equal(gasto("Personales", "Personales", "Apple.com/bill"), "retiros");
assert.equal(gasto("Impuestos", "Impuestos", "ARCA VEP — IVA período 09/2026"), "impuestos");
assert.equal(gasto("Bancos y financieros", "Financieros", "Interés préstamo José Alvarez"), "bancos");
assert.equal(gasto("Operativos", "Compras sin factura", "Reintegro a Seba"), "proveedores");
assert.equal(gasto("Local y servicios", "Alquiler", "Alquiler"), "gastos");

let id = 0;
const linea = (fecha: string, monto: number, saldo: number | null, extra: Partial<LineaBancoCF> = {}): LineaBancoCF => ({
  id: `l${++id}`, cuenta_id: "cc", fecha, descripcion: "TRANSFERENCIA", monto: Math.abs(monto), tipo: monto >= 0 ? "credito" : "debito",
  clasificacion: null, subtipo: null, saldo, ...extra,
});
const fila = (monto: number, extra: Partial<LineaBancoCF>) => filaDeLineaBanco(linea("2026-10-01", monto, null, extra));
assert.equal(fila(100, { clasificacion: "cobro" }), "cobros");
assert.equal(fila(-100, { clasificacion: "cheque_devuelto" }), "cobros", "un cheque rechazado resta de los cobros");
assert.equal(fila(-100, { clasificacion: "cheque_emitido" }), "proveedores");
assert.equal(fila(-100, { clasificacion: "pago", gasto: { grupo: "Personal", categoria: "Sueldos", descripcion: "Sueldo Sebastián" } }), "sueldos", "manda el gasto atado");
assert.equal(fila(-100, { clasificacion: "personal" }), "retiros");
assert.equal(fila(-100, { clasificacion: "fci" }), "pases");
assert.equal(fila(-100, { clasificacion: "tarjeta" }), "bancos");
assert.equal(fila(100, { clasificacion: "intereses", subtipo: "reintegro" }), "otros_ingresos");
assert.equal(fila(-100, { clasificacion: "impuesto", subtipo: "sircreb" }), "impuestos");
assert.equal(fila(-100, { clasificacion: "otro" }), "otros_pagos");
assert.equal(fila(-589100, { ignorada: true, nota: "Pago del 07/10 a Jerónimo Casadidio: ya cargado en Gastos (Premio agosto)" }), "sueldos", "ignorada en Bancos: igual salió la plata");
assert.equal(fila(-2680080, { ignorada: true, nota: "Pago de mercadería importada a Gaspar Federico Ovando" }), "proveedores");
// Sin clasificar: por el texto o el código del banco.
assert.equal(fila(-16526.65, { descripcion: "LEY NRO 25.4 23/10/26 00002 #609" }), "impuestos");
assert.equal(fila(-3190, { descripcion: "COMISION GES · CTE 000000089920 #392" }), "bancos");
assert.equal(fila(3257745.49, { descripcion: "PAGO A PROVEEDORES OP.2610794 #983" }), "cobros", "un cliente que nos paga");
assert.equal(fila(-60500, { descripcion: "TRANSFERENCI 202530102618" }), "otros_pagos");

// ── Saldo del extracto (el orden dentro del día no se guarda) ──
// Arranca el día con 1.000: +500 (1.500), −200 (1.300), +50 (1.350). Las líneas vienen desordenadas.
const dia = [linea("2026-10-13", -200, 1300), linea("2026-10-13", 50, 1350), linea("2026-10-13", 500, 1500)];
assert.equal(cierreDelDia(dia), 1350);
assert.equal(saldoAlArrancar(dia, "2026-10-12"), 1000, "arranque del primer día");
assert.equal(saldoAlArrancar([...dia, linea("2026-10-15", -100, 1250)], "2026-10-15"), 1350, "cierre del día anterior");
assert.equal(cierreDelDia([linea("2026-10-13", -200, 9), linea("2026-10-13", 50, 7)]), null, "no cuadra: no inventa");

// ── Proyección (hoy jueves 29/10/2026) ──
const HOY = "2026-10-29";
const p = proyeccionCF({
  hoy: HOY, hasta: "2027-01-17", dolar: 1000,
  vencimientos: [
    { lado: "venta", vence: "2026-11-05", saldo: 100_000, moneda: "ARS", comprobante: "FA 0015-00000100", nombre: "Corteva" },
    { lado: "venta", vence: "2026-10-20", saldo: 50_000, moneda: "ARS", comprobante: "FA 0015-00000090", nombre: "Atrasado SA" },
    { lado: "venta", vence: "2026-11-20", saldo: 1_000, moneda: "USD", comprobante: "FA 0015-00000101", nombre: "Synthon" },
    { lado: "compra", vence: "2026-10-15", saldo: 30_000, moneda: "ARS", comprobante: "FC 1-2", nombre: "Proveedor viejo" },
    { lado: "compra", vence: "2027-02-01", saldo: 99_000, moneda: "ARS", comprobante: "FC 1-3", nombre: "Muy lejos" },
  ],
  cheques: [
    { numero: "90000200", direccion: "emitido", estado: "entregado", estadoBanco: "ACTIVO", fecha_pago: "2026-11-02", monto: 20_000, quien: "Ombu" },
    { numero: "90000201", direccion: "emitido", estado: "entregado", estadoBanco: "ACTIVO", fecha_pago: "2026-11-03", monto: 7_000 },
    { numero: "90000202", direccion: "emitido", estado: "entregado", estadoBanco: "PAGADO", fecha_pago: "2026-11-03", monto: 8_000 },
    { numero: "90000203", direccion: "emitido", estado: "entregado", estadoBanco: "ACTIVO", fecha_pago: "2026-11-04", monto: 9_000, cubreTercero: "Martín Fernández" },
    { numero: "90000205", direccion: "emitido", estado: "entregado", estadoBanco: "ACTIVO", fecha_pago: "2026-10-27", monto: 3_000 },
    { numero: "90000204", direccion: "emitido", estado: "cobrado", estadoBanco: "PAGADO", fecha_pago: "2026-11-04", monto: 1_000 },
    { numero: "62245658", direccion: "recibido", estado: "en_cartera", fecha_pago: "2026-10-27", monto: 40_000, quien: "Racing" },
    { numero: "62245659", direccion: "recibido", estado: "endosado", fecha_pago: "2026-11-27", monto: 40_000 },
  ],
  debitados: new Set(["90000201"]),
  fijos: [
    { id: "f1", descripcion: "Sueldo Sebastián Pereyra", grupo: "Personal", categoria: "Sueldos", monto: 1_500_000, moneda: "ARS", activo: true, diaVencimiento: null },
    { id: "f2", descripcion: "ARBA plan de pagos web AA544RB 780101", grupo: "Impuestos", categoria: "Impuestos", monto: 1_866.2, moneda: "ARS", activo: true, diaVencimiento: 10 },
    { id: "f3", descripcion: "Google Workspace", grupo: "Operativos", categoria: "Operativos", monto: 100, moneda: "USD", activo: true, diaVencimiento: 1 },
  ],
  pagosFijos: [{ gasto_fijo_id: "f2", fecha: "2026-10-10" }],
  premios: [{ persona: "Jerónimo Casadidio", monto: 300_000, mes: "2026-10" }],
});
const de = (texto: string) => p.items.filter((i) => i.detalle.includes(texto));
assert.deepEqual(de("FA 0015-00000100").map((i) => [i.fecha, i.monto, i.fila]), [["2026-11-05", 100_000, "cobros"]]);
assert.deepEqual(de("Synthon").map((i) => i.monto), [1_000_000], "US$ al dólar del día");
assert.deepEqual(p.vencidoSinCobrar, { total: 50_000, cantidad: 1 }, "lo vencido sin cobrar no se cuenta");
assert.deepEqual(de("Proveedor viejo").map((i) => [i.fecha, i.monto, i.atrasado]), [[HOY, -30_000, true]], "lo atrasado se paga hoy");
assert.equal(de("Muy lejos").length, 0, "después de la semana 12 no entra");
assert.deepEqual(de("Cheque 90000200").map((i) => [i.fecha, i.monto, i.fila]), [["2026-11-02", -20_000, "proveedores"]]);
assert.equal(de("Cheque 90000201").length + de("Cheque 90000202").length + de("Cheque 90000204").length, 0, "debitados, pagados o cobrados no salen otra vez");
assert.deepEqual(de("Cheque 90000205").map((i) => [i.fecha, i.monto, i.atrasado]), [[HOY, -3_000, undefined]], "cheque sin debitar: se cuenta hoy, pero no está atrasado (30 días)");
assert.deepEqual(p.chequesDeTerceros, { total: 9_000, cantidad: 1 });
assert.deepEqual(de("Cheque 62245658").map((i) => [i.fecha, i.monto, i.fila]), [[HOY, 40_000, "cobros"]], "en cartera ya en fecha: se deposita hoy");
assert.equal(de("Cheque 62245659").length, 0, "endosado: ya no está");
assert.deepEqual(de("Sueldo Sebastián").map((i) => [i.fecha, i.monto, i.fila]),
  [[HOY, -1_500_000, "sueldos"], ["2026-11-10", -1_500_000, "sueldos"], ["2026-12-10", -1_500_000, "sueldos"], ["2027-01-10", -1_500_000, "sueldos"]],
  "octubre sin pagar va hoy; después el 10 de cada mes");
assert.deepEqual(de("ARBA").map((i) => [i.fecha, i.fila]), [["2026-11-10", "retiros"], ["2026-12-10", "retiros"], ["2027-01-10", "retiros"]], "octubre ya pagado");
assert.deepEqual(de("Google").map((i) => [i.fecha, i.monto]), [[HOY, -100_000], ["2026-11-01", -100_000], ["2026-12-01", -100_000], ["2027-01-01", -100_000]]);
assert.deepEqual(de("Premio").map((i) => [i.fecha, i.monto, i.fila]), [["2026-11-10", -300_000, "sueldos"]], "premio de octubre con el sueldo de noviembre");
assert.deepEqual(proyeccionCF({ hoy: HOY, hasta: "2026-11-30", dolar: null, vencimientos: [{ lado: "venta", vence: "2026-11-20", saldo: 5, moneda: "USD", comprobante: "FA 1", nombre: "X" }], cheques: [], fijos: [], pagosFijos: [] }).sinDolar, ["FA 1 — X (US$ 5)"]);

// ── Semanas ──
// Cuenta "cc": arranca el martes 13/10 con 1.000. Semana del 12/10: +500 −200 +50 → 1.350. Semana del 19/10: −100 (fci) → 1.250.
// Semana de hoy (26/10): el lunes entra un cobro de 300 → 1.550.
const lineas = [...dia, linea("2026-10-20", -100, 1250, { clasificacion: "fci" }), linea("2026-10-26", 300, 1550, { clasificacion: "cobro" })];
const proy = proyeccionCF({ hoy: HOY, hasta: "2026-11-08", dolar: 1000, vencimientos: [{ lado: "venta", vence: "2026-10-30", saldo: 1_000, moneda: "ARS", comprobante: "FA 1", nombre: "Cliente" }, { lado: "compra", vence: "2026-11-03", saldo: 400, moneda: "ARS", comprobante: "FC 2", nombre: "Prov" }], cheques: [], fijos: [], pagosFijos: [] });
const cf = armarCashflow({ hoy: HOY, lineas, cuentas: { cc: "BBVA CC" }, proyeccion: proy.items, semanasProyectadas: 2 });
assert.equal(cf.saldoInicial, 1000);
assert.deepEqual(cf.semanas.map((s) => [s.desde, s.tipo]), [["2026-10-12", "real"], ["2026-10-19", "real"], ["2026-10-26", "proyectada"], ["2026-11-02", "proyectada"]]);
const [s1, s2, s3, s4] = cf.semanas;
assert.equal(totalEntra(s1.real!), 550);
assert.equal(totalSale(s1.real!), -200);
assert.deepEqual(s1.saldoReal, { inicial: 1000, final: 1350 });
assert.equal(s2.real!.pases, -100);
assert.deepEqual(s2.saldoReal, { inicial: 1350, final: 1250 }, "el saldo final es el del banco");
assert.equal(s2.proy, null);
assert.equal(s3.proyDe, "hoy");
assert.equal(s3.proy!.cobros, 1_300, "semana de hoy: lo real hasta ayer (300) + lo que vence de hoy al domingo (1.000)");
assert.deepEqual(s3.saldoProy, { inicial: 1250, final: 2550 });
assert.deepEqual(s3.saldoReal, { inicial: 1250, final: 1550 }, "lo real de la semana, hasta hoy");
assert.equal(s4.real, null, "la semana que viene todavía no pasó");
assert.equal(s4.proy!.proveedores, -400);
assert.deepEqual(s4.saldoProy, { inicial: 2550, final: 2150 });
assert.equal(flujo(s4.proy!), -400);

// La foto del mes: solo las semanas que arrancan en octubre. Con la foto de noviembre, la semana del 2/11 usa la foto.
assert.deepEqual(Object.keys(fotoDelMes(cf).semanas), ["2026-10-26"]);
const conFoto = armarCashflow({ hoy: HOY, lineas, cuentas: { cc: "BBVA CC" }, proyeccion: proy.items, semanasProyectadas: 2, fotos: { "2026-11": { tomada: "2026-11-01", semanas: { "2026-11-02": { proveedores: -999 } } } } });
assert.equal(conFoto.semanas[3].proyDe, "foto");
assert.equal(conFoto.semanas[3].proy!.proveedores, -999);
assert.equal(conFoto.semanas[3].proy!.cobros, 0);
assert.equal(conFoto.semanas[3].detalleProy.length, 0);

// Una cuenta sin saldo en el extracto avisa y no suma.
const sinSaldo = armarCashflow({ hoy: HOY, lineas: [...lineas, { ...linea("2026-10-14", -5, null), cuenta_id: "ca" }], cuentas: { cc: "BBVA CC", ca: "Caja de ahorro" }, proyeccion: [], semanasProyectadas: 1 });
assert.deepEqual(sinSaldo.cuentasSinSaldo, ["Caja de ahorro"]);
assert.match(sinSaldo.avisos[0], /Caja de ahorro/);

// Control contra el saldo del banco: si faltan líneas, avisa (y no toca las cuentas).
const control = armarCashflow({ hoy: HOY, lineas, cuentas: { cc: "BBVA CC" }, proyeccion: [], semanasProyectadas: 1, saldosBanco: [{ cuenta_id: "cc", saldo: 1_608.74, fecha: "2026-10-28" }] });
assert.match(control.avisos[0], /BBVA CC: las líneas cargadas en Bancos dan \$ 58,74 menos que el saldo del banco al 28\/10: falta alguna línea/);
assert.equal(control.semanas[2].saldoReal!.final, 1550);
assert.equal(armarCashflow({ hoy: HOY, lineas, cuentas: { cc: "BBVA CC" }, proyeccion: [], semanasProyectadas: 1, saldosBanco: [{ cuenta_id: "cc", saldo: 1_550, fecha: "2026-10-28" }] }).avisos.length, 0, "si cuadra, no avisa");

// Excel: semana real = 1 columna; proyectada = 2 (Proy. y Real).
const pl = planillaCF(cf, (d) => d.slice(5));
assert.equal(pl[0].length, 1 + 2 + 2 * 2);
assert.deepEqual(pl[1].slice(1), ["Real", "Real", "Proy. (hoy)", "Real", "Proy. (hoy)", "Real"]);
assert.deepEqual(pl[pl.length - 1], ["Saldo final", 1350, 1250, 2550, 1550, 2150, null]);

console.log("test-cashflow OK");
