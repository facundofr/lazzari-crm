// Prueba rápida: npx tsx scripts/test-saldo-cuentas.mjs
import assert from "node:assert/strict";
import { calcularSaldosCuentas, sugerenciasCuentas, debitosPorSemana, montoCuentaDeOp, grupoCuentaSugerido as g } from "../src/lib/saldo-cuentas.ts";
import { diaHabilAnterior, diaHabilDesde, esDiaHabil } from "../src/lib/dias-habiles.ts";

// Días hábiles: 12/10/2026 es feriado, 6/11 Día del Bancario.
assert.equal(esDiaHabil("2026-10-12"), false);
assert.equal(diaHabilDesde("2026-10-11"), "2026-10-13");
assert.equal(diaHabilAnterior("2026-10-13"), "2026-10-09");
assert.equal(diaHabilDesde("2026-11-06"), "2026-11-09");

// Regla de cuenta sugerida (igual que el trigger de la base).
assert.equal(g({ tipo: "transferencia", cliente_id: "c" }), "banco");
assert.equal(g({ tipo: "pago", proveedor_id: "p" }), "banco");
assert.equal(g({ tipo: "efectivo", cliente_id: "c" }), "efectivo");
assert.equal(g({ tipo: "echeq", cliente_id: "c" }), "cheques_cartera");
assert.equal(g({ tipo: "echeq", proveedor_id: "p" }), "cheques_emitidos");
assert.equal(g({ tipo: "cheque_recibido", cliente_id: "c" }), "cheques_cartera");
assert.equal(g({ tipo: "cheque_emitido", proveedor_id: "p" }), "cheques_emitidos");
assert.equal(g({ tipo: "tarjeta", proveedor_id: "p" }), "tarjeta_credito");
assert.equal(g({ tipo: "tarjeta", cliente_id: "c" }), "banco");
assert.equal(g({ tipo: "retencion_ganancias", cliente_id: "c" }), null);
assert.equal(g({ tipo: "cobro", cliente_id: "c", anulado: true }), null);
assert.equal(g({ tipo: "cobro", cliente_id: "c", descripcion: "[Ajuste manual] x" }), null);

const corte = "2026-08-31";
const cuentas = [
  { id: "cc", nombre: "CC", tipo: "cuenta_corriente", moneda: "ARS", fecha_corte: corte, saldo_inicial: 10829781.65, acuerdo: 1500000 },
  { id: "ca", nombre: "CA", tipo: "caja_ahorro", moneda: "ARS", fecha_corte: corte, saldo_inicial: null },
  { id: "ef", nombre: "Efectivo", tipo: "efectivo", moneda: "ARS", fecha_corte: corte, saldo_inicial: "33520" },
  { id: "usd", nombre: "CA U$S", tipo: "caja_ahorro", moneda: "USD", fecha_corte: corte, saldo_inicial: 14.62 },
  { id: "visa", nombre: "Visa", tipo: "tarjeta_credito", moneda: "ARS", fecha_corte: corte, saldo_inicial: null },
  { id: "cart", nombre: "Cartera", tipo: "cheques_cartera", moneda: "ARS", fecha_corte: corte, saldo_inicial: null },
  { id: "emi", nombre: "Emitidos", tipo: "cheques_emitidos", moneda: "ARS", fecha_corte: corte, saldo_inicial: null },
  { id: "vieja", nombre: "Inactiva", tipo: "efectivo", moneda: "ARS", fecha_corte: corte, saldo_inicial: 999, activa: false },
];
const movs = [
  { cuenta_id: "cc", tipo: "transferencia", cliente_id: "c", fecha: "2026-09-05", monto: 1000000 },        // +
  { cuenta_id: "cc", tipo: "pago", proveedor_id: "p", fecha: "2026-09-06", monto: "250000.50" },           // −
  { cuenta_id: "cc", tipo: "transferencia", cliente_id: "c", fecha: "2026-08-31", monto: 5000 },           // el día del corte: ya está en el saldo
  { cuenta_id: "cc", tipo: "transferencia", cliente_id: "c", fecha: "2026-09-07", monto: 7000, anulado: true },
  { cuenta_id: "cc", tipo: "retencion_ganancias", cliente_id: "c", fecha: "2026-09-07", monto: 3000 },     // no es plata
  { cuenta_id: "ef", tipo: "efectivo", cliente_id: "c", fecha: "2026-09-10", monto: 20000 },
  { cuenta_id: "vieja", tipo: "efectivo", cliente_id: "c", fecha: "2026-09-10", monto: 1 },                // cuenta inactiva: se ignora
  { cuenta_id: null, tipo: "transferencia", cliente_id: "c", fecha: "2026-09-02", monto: 400 },            // sin cuenta
  { cuenta_id: null, tipo: "pago", proveedor_id: "p", fecha: "2026-09-03", monto: 100 },                   // sin cuenta
  { cuenta_id: null, tipo: "pago", proveedor_id: "p", fecha: "2026-08-20", monto: 999 },                   // antes del corte: no cuenta
  { cuenta_id: null, tipo: "transferencia", cliente_id: "c", fecha: "2026-09-02", monto: 50, moneda: "USD" },
];
const hoy = "2026-10-11";
const cheques = [
  { direccion: "recibido", estado: "en_cartera", monto: 3677887.22, fecha_pago: "2026-11-20" },
  { direccion: "recibido", estado: "en_cartera", monto: 100, fecha_pago: "2026-10-15" },
  { direccion: "recibido", estado: "depositado", monto: 10110492.35, fecha_pago: "2026-10-16" },
  { direccion: "recibido", estado: "rechazado", monto: 7623000, fecha_pago: "2026-10-05" },
  { direccion: "emitido", estado: "pendiente", monto: 200, fecha_pago: "2026-10-08" },                   // vencido sin debitar
  { direccion: "emitido", estado: "entregado", monto: 300, fecha_pago: "2026-10-18" },                   // próximos 7 días
  { direccion: "emitido", estado: "pendiente", monto: 400, fecha_pago: "2026-10-25" },                   // resto del mes
  { direccion: "emitido", estado: "pendiente", monto: 500, fecha_pago: "2026-11-05" },                   // después
  { direccion: "emitido", estado: "cobrado", monto: 9999, fecha_pago: "2026-10-01" },                    // ya debitado
];

const r = calcularSaldosCuentas(cuentas, movs, cheques, hoy);
assert.equal(r.porCuenta.cc.saldo, 11579781.15);
assert.equal(r.porCuenta.cc.cantidadMovimientos, 2);
assert.equal(r.porCuenta.cc.disponibleConAcuerdo, 13079781.15);
assert.equal(r.porCuenta.ca.faltaSaldoInicial, true);
assert.equal(r.porCuenta.ca.saldo, 0);
assert.equal(r.porCuenta.ef.saldo, 53520);
assert.equal(r.porCuenta.usd.saldo, 14.62);
assert.equal(r.porCuenta.visa.saldo, 0);
assert.equal(r.porCuenta.visa.faltaSaldoInicial, false);
assert.equal(r.porCuenta.vieja, undefined);
assert.equal(r.porCuenta.cart.saldo, 3677987.22);
assert.equal(r.porCuenta.cart.cantidadCheques, 2);
assert.equal(r.porCuenta.cart.depositados, 10110492.35);
assert.equal(r.porCuenta.emi.saldo, 1400);
assert.deepEqual(r.porCuenta.emi.vencimientos, { vencidos: 200, proximos7: 300, restoMes: 400, despues: 500 });
// Débitos por día hábil: domingo 18/10 → lunes 19/10; domingo 25/10 → lunes 26/10.
assert.deepEqual(r.porCuenta.emi.debitos, [
  { fecha: "2026-10-08", monto: 200, cantidad: 1, atrasado: true },
  { fecha: "2026-10-19", monto: 300, cantidad: 1, atrasado: false },
  { fecha: "2026-10-26", monto: 400, cantidad: 1, atrasado: false },
  { fecha: "2026-11-05", monto: 500, cantidad: 1, atrasado: false },
]);
// Un cheque del sábado 10/10 no está atrasado el domingo 11: se debita el martes 13 (12 es feriado).
assert.deepEqual(calcularSaldosCuentas(cuentas, [], [{ direccion: "emitido", estado: "pendiente", monto: 1, fecha_pago: "2026-10-10" }], hoy).porCuenta.emi.debitos,
  [{ fecha: "2026-10-13", monto: 1, cantidad: 1, atrasado: false }]);
const sem = debitosPorSemana(r.porCuenta.emi.debitos, hoy, 3);
assert.equal(sem.atrasado, 200);
assert.deepEqual(sem.semanas.map((w) => [w.desde, w.monto]), [["2026-10-05", 0], ["2026-10-12", 0], ["2026-10-19", 300]]);
assert.equal(sem.semanas[2].dias[0].rescatarEl, "2026-10-16");
assert.equal(sem.despues, 900);
assert.deepEqual(r.totales.ARS, {
  disponible: 11633301.15, chequesCartera: 3677987.22, chequesDepositados: 10110492.35, comprometidoEmitidos: 1400, deudaTarjetas: 0,
});
assert.equal(r.totales.USD.disponible, 14.62);
assert.deepEqual(r.sinCuenta.ARS, { cantidad: 2, ingresos: 400, egresos: 100 });
assert.deepEqual(r.sinCuenta.USD, { cantidad: 1, ingresos: 50, egresos: 0 });

// Sugerencias: CC en negativo → rescatar del FCI; cubrir los cheques un día hábil antes del débito.
const base = [
  { id: "cc", nombre: "CC", tipo: "cuenta_corriente", moneda: "ARS", fecha_corte: corte, saldo_inicial: -1575636.31, acuerdo: 1500000, predeterminada: true },
  { id: "cc2", nombre: "CC2", tipo: "cuenta_corriente", moneda: "ARS", fecha_corte: corte, saldo_inicial: 4797.36 },
  { id: "fci", nombre: "FCI", tipo: "fci", moneda: "ARS", fecha_corte: corte, saldo_inicial: 71480800.7 },
  { id: "emi", nombre: "Emitidos", tipo: "cheques_emitidos", moneda: "ARS", fecha_corte: corte, saldo_inicial: null },
];
const sug = (cs, chs = []) => sugerenciasCuentas(cs, calcularSaldosCuentas(cs, [], chs, hoy, []), hoy);
let s1 = sug(base);
assert.equal(s1.length, 1);
assert.deepEqual(s1[0], { tipo: "rescatar_fci", cuentaId: "cc", desdeId: "fci", monto: 1576000, saldo: -1575636.31, chequesProximos: 0, debitoHasta: null });
// Hoy domingo 11/10: el cheque del 13/10 (12 es feriado) se rescata el 09/10 → ya hay que cubrirlo. El del 14/10 se rescata el 13/10 → todavía no.
s1 = sug(base, [
  { direccion: "emitido", estado: "pendiente", monto: 2000000, fecha_pago: "2026-10-12" },
  { direccion: "emitido", estado: "pendiente", monto: 700, fecha_pago: "2026-10-14" },
  { direccion: "emitido", estado: "pendiente", monto: 900, fecha_pago: "2026-11-30" },
]);
assert.equal(s1[0].monto, 3576000);
assert.equal(s1[0].chequesProximos, 2000000);
assert.equal(s1[0].debitoHasta, "2026-10-13");
// CC en positivo y cheque recién la semana que viene: nada para hoy.
assert.deepEqual(sug([{ ...base[0], saldo_inicial: 10 }, base[2], base[3]], [{ direccion: "emitido", estado: "pendiente", monto: 5000, fecha_pago: "2026-10-21" }]), []);
// Sin negativo ni cheques próximos: nada que sugerir.
assert.deepEqual(sug([{ ...base[0], saldo_inicial: 10 }, base[2]]), []);
// El FCI no alcanza: avisa cuánto falta.
s1 = sug([base[0], { ...base[2], saldo_inicial: 500000 }]);
assert.equal(s1[0].tipo, "falta_plata");
assert.equal(s1[0].monto, 1075636.31);
// Sin saldo al corte cargado: no sugiere.
assert.deepEqual(sug([{ ...base[0], saldo_inicial: null }, base[2]]), []);

// Etapa 2: con extracto, el saldo es el del banco + lo del CRM posterior al extracto.
{
  const cs = [
    { id: "cc", nombre: "CC", tipo: "cuenta_corriente", moneda: "ARS", fecha_corte: "2026-08-31", saldo_inicial: 10829781.65, saldo_banco: -1575636.31, saldo_banco_fecha: "2026-10-09" },
    { id: "fci", nombre: "FCI", tipo: "fci", moneda: "ARS", fecha_corte: "2026-08-31", saldo_inicial: 1000 },
    { id: "ef", nombre: "Efectivo", tipo: "efectivo", moneda: "ARS", fecha_corte: "2026-08-31", saldo_inicial: null, saldo_banco: null },
  ];
  const movs = [
    { cuenta_id: "cc", tipo: "pago", proveedor_id: "p", monto: 500, fecha: "2026-10-05" }, // ya está en el extracto
    { cuenta_id: "cc", tipo: "cobro", cliente_id: "c", monto: 2000, fecha: "2026-10-10" }, // posterior al extracto
  ];
  const pases = [
    { cuenta_id: "fci", fecha: "2026-09-10", importe: 300 },   // suscripción al FCI (sale de la CC)
    { cuenta_id: "fci", fecha: "2026-10-01", importe: -100 },  // rescate
    { cuenta_id: "fci", fecha: "2026-08-20", importe: 999 },   // antes del corte: no cuenta
    { cuenta_id: "ef", fecha: "2026-09-25", importe: 6200000 }, // extracción de efectivo
  ];
  const r = calcularSaldosCuentas(cs, movs, [], "2026-10-11", pases);
  assert.equal(r.porCuenta.cc.saldo, -1575636.31 + 2000);
  assert.equal(r.porCuenta.cc.segunBanco, "2026-10-09");
  assert.equal(r.porCuenta.cc.cantidadMovimientos, 1);
  assert.equal(r.porCuenta.fci.saldo, 1200);
  assert.equal(r.porCuenta.fci.pases, 200);
  assert.equal(r.porCuenta.fci.segunBanco, null);
  assert.equal(r.porCuenta.ef.saldo, 0); // la extracción no se supone en la caja
  assert.equal(r.porCuenta.ef.faltaSaldoInicial, true);
}

// FCI: sin interés estimado. Con saldo del banco, manda el banco; los pases anteriores no suman.
{
  const cs = [{ id: "fci", nombre: "FCI", tipo: "fci", moneda: "ARS", fecha_corte: "2026-08-31", saldo_inicial: 97564382.92, saldo_banco: 71480800.7, saldo_banco_fecha: "2026-10-11" }];
  const r = calcularSaldosCuentas(cs, [], [], "2026-10-11", [{ cuenta_id: "fci", fecha: "2026-10-01", importe: -25000000.01 }]);
  assert.equal(r.porCuenta.fci.saldo, 71480800.7);
  assert.equal(r.porCuenta.fci.segunBanco, "2026-10-11");
  // Efectivo con el saldo de la caja de Augusto al 09/10.
  const ef = [{ id: "ef", nombre: "Efectivo", tipo: "efectivo", moneda: "ARS", fecha_corte: "2026-08-31", saldo_inicial: 33520, saldo_banco: 2561020, saldo_banco_fecha: "2026-10-09" }];
  assert.equal(calcularSaldosCuentas(ef, [], [], "2026-10-11", [{ cuenta_id: "ef", fecha: "2026-09-25", importe: 6200000 }]).porCuenta.ef.saldo, 2561020);
}

// OPs: solo la parte en transferencias sale del banco ese día; lo de cheques sale al debitarse.
assert.equal(montoCuentaDeOp([{ tipo: "echeq", monto: 527103.55 }, { tipo: "transferencia", monto: 527103.55 }, { tipo: "transferencia", monto: 0 }]), 527103.55);
assert.equal(montoCuentaDeOp('[{"tipo":"cheque_propio","monto":1000}]'), 0);
assert.equal(montoCuentaDeOp([{ tipo: "tarjeta", monto: 42978 }]), 0);
assert.equal(montoCuentaDeOp(null), null);
{
  const cs = [{ id: "cc", nombre: "CC", tipo: "cuenta_corriente", moneda: "ARS", fecha_corte: "2026-08-31", saldo_inicial: 0, saldo_banco: 1000, saldo_banco_fecha: "2026-10-09" }];
  const movs = [
    { cuenta_id: "cc", tipo: "pago", proveedor_id: "p", fecha: "2026-10-12", monto: 4096211.32, montoCuenta: 0 },     // OP con eCheq: no resta hoy
    { cuenta_id: "cc", tipo: "pago", proveedor_id: "p", fecha: "2026-10-12", monto: 1500, montoCuenta: 400 },         // mixta: resta la transferencia
    { cuenta_id: null, tipo: "pago", proveedor_id: "p", fecha: "2026-10-12", monto: 900, montoCuenta: 0 },            // sin cuenta, todo cheques: no avisa
    { cuenta_id: null, tipo: "retencion_ganancias", proveedor_id: "p", fecha: "2026-10-12", monto: 50 },             // retención: no avisa
    { cuenta_id: null, tipo: "cheque_recibido", cliente_id: "c", fecha: "2026-10-12", monto: 3677887.22 },          // cheque: va por la cartera
    { cuenta_id: null, tipo: "transferencia", cliente_id: "c", fecha: "2026-10-12", monto: 20000 },                  // este sí falta
  ];
  const r = calcularSaldosCuentas(cs, movs, [], "2026-10-12");
  assert.equal(r.porCuenta.cc.saldo, 600);
  assert.equal(r.porCuenta.cc.cantidadMovimientos, 1);
  assert.deepEqual(r.sinCuenta.ARS, { cantidad: 1, ingresos: 20000, egresos: 0 });
}

console.log("saldo-cuentas OK");
