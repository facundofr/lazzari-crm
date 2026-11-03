// npx tsx scripts/test-cheques-a-cubrir.ts
// P07 (auditoría 02/11/2026; Augusto: los de Martín F. "Suman en a cubrir"): el mismo juego de cheques da el mismo "a cubrir esta
// semana" en el Inicio, en la tarjeta Bancos de Finanzas, en Cheques y en el asistente. Nunca contra el saldo.
import assert from "node:assert/strict";
import { enFecha, fechaACubrir, semanaACubrir, totalACubrir, type ChequeFL } from "../src/lib/cheques-lazza";
import { chequesPorDia, plazosCheques, semanasTablero, type ChequeTablero } from "../src/lib/tablero-inicio";
import { numerosDebitados } from "../src/lib/cobertura-cheques";

const HOY = "2026-11-04"; // miércoles: esta semana va hasta el domingo 08/11
const DOLAR = 1000;
let n = 0;
const ch = (x: Partial<ChequeFL & { cubre_tercero: string }>): ChequeFL => ({
  id: String(++n), numero: `900170${String(n).padStart(2, "0")}`, direccion: "emitido", estado: "entregado", fecha_pago: HOY, monto: 0, moneda: "ARS", ...x,
});
const cheques: ChequeFL[] = [
  ch({ numero: "90017001", fecha_pago: "2026-11-01", monto: 1000 }),                          // en fecha (pasó la fecha, < 30 días): hoy
  ch({ numero: "90017002", fecha_pago: "2026-11-06", monto: 2000, cubre_tercero: "Martín Fernández" }), // lo cubre Martín F.: SUMA
  ch({ numero: "90017003", fecha_pago: "2026-11-03", monto: 5000 }),                          // el extracto ya trae su débito: no
  ch({ numero: "90017004", fecha_pago: "2026-09-20", monto: 7000 }),                          // más de 30 días: venció, no
  ch({ numero: "90017005", fecha_pago: "2026-11-08", monto: 300 }),                           // domingo: último día de la semana
  ch({ numero: "90017006", fecha_pago: "2026-11-09", monto: 999 }),                           // lunes: la semana que viene
  ch({ numero: "90017007", fecha_pago: "2026-11-05", monto: 400, estadoBanco: "PAGADO" }),    // el reporte eCheq dice pagado: no
  ch({ numero: "90017008", fecha_pago: "2026-11-05", monto: 10, moneda: "USD" }),             // en dólares
  ch({ numero: "90017009", fecha_pago: "2026-11-05", monto: 50, direccion: "recibido", estado: "en_cartera" }), // de terceros: no
  ch({ numero: "90010", fecha_pago: "2026-11-05", monto: 60, estado: "cobrado" }),         // ya debitado en el CRM: no
];
const debitados = numerosDebitados([{ descripcion: "PAGO CHEQUE 24HS 90017003", tipo: "debito" }]);
const sem = semanaACubrir(HOY);
assert.deepEqual(sem, { desde: HOY, hasta: "2026-11-08" });
assert.equal(semanaACubrir("2026-11-08").hasta, "2026-11-15", "un domingo, hasta el domingo que viene");

// La regla
assert.equal(fechaACubrir(cheques[0], HOY, debitados), HOY, "en fecha se cubre hoy");
assert.equal(fechaACubrir(cheques[1], HOY, debitados), "2026-11-06", "Martín F. suma");
assert.equal(fechaACubrir(cheques[2], HOY, debitados), null, "debitado según el extracto");
assert.equal(fechaACubrir(cheques[3], HOY, debitados), null, "vencido hace más de 30 días");
assert.equal(fechaACubrir(cheques[6], HOY, debitados), null, "PAGADO según el banco");
assert.equal(fechaACubrir(cheques[8], HOY, debitados), null, "recibido");

// Finanzas (tarjeta Bancos) y Cheques: totalACubrir de hoy al domingo
const t = totalACubrir(cheques, HOY, sem.hasta, debitados);
assert.deepEqual(t, { cantidad: 4, ARS: 3300, USD: 10 });

// Inicio: la pantalla saca los debitados según el extracto y el resto lo hace la regla común
const sinDebitar = cheques.filter((c) => !debitados.has(c.numero.replace(/^0+/, ""))) as unknown as ChequeTablero[];
const plazos = plazosCheques(sinDebitar, HOY, DOLAR, semanasTablero(HOY));
assert.equal(plazos.semanas[0], 3300 + 10 * DOLAR, "Inicio: esta semana = lo mismo (los dólares al dólar del día)");
assert.equal(chequesPorDia(sinDebitar, HOY, DOLAR, semanasTablero(HOY)[0]).reduce((s, d) => s + d.pesos, 0), 3300 + 10 * DOLAR, "Inicio: día por día suma igual");
assert.equal(chequesPorDia(sinDebitar, HOY, DOLAR, semanasTablero(HOY)[0]).find((d) => d.fecha === HOY)?.pesos, 1000, "el en fecha cae hoy");

// Asistente: a cubrir con fecha hasta N días (7 → hasta el 11/11 entra también el del lunes)
const asistente = (dias: number) => cheques.filter((c) => { const f = fechaACubrir(c, HOY, debitados); return f !== null && f <= new Date(Date.parse(`${HOY}T12:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10); });
assert.equal(asistente(4).filter((c) => c.moneda !== "USD").reduce((s, c) => s + Number(c.monto), 0), 3300, "asistente hasta el domingo = lo mismo");
assert.equal(asistente(7).length, 5, "asistente 7 días suma el del lunes");

// Cheques: "En fecha para pagar" usa la misma regla (sin el debitado según el extracto)
assert.deepEqual(enFecha(cheques, HOY, debitados).pagar, { cantidad: 1, ARS: 1000, USD: 0 });
assert.deepEqual(enFecha(cheques, HOY).pagar, { cantidad: 2, ARS: 6000, USD: 0 }, "sin el extracto, el debitado todavía figura");

console.log("test-cheques-a-cubrir OK");
