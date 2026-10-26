// Prueba rápida: npx tsx scripts/test-cobertura-cheques.ts
import assert from "node:assert/strict";
import { coberturaCheques, sobraOFalta, diasDesde, numerosDebitados, type ChequeCobertura } from "../src/lib/cobertura-cheques";

const HOY = "2026-10-25";
const ch = (numero: string, monto: number, fecha_pago: string, estado = "entregado", estadoBanco: string | null = "ACTIVO", extra: Partial<ChequeCobertura> = {}): ChequeCobertura =>
  ({ numero, monto, fecha_pago, estado, estadoBanco, direccion: "emitido", moneda: "ARS", ...extra });

const c = coberturaCheques([
  ch("90017001", 1000, "2026-10-12", "entregado", "PRESENTADO"),   // vencido, en trámite
  ch("90017002", 500, "2026-10-21", "entregado", "DEPOSITADO"),     // vencido, en trámite
  ch("90017003", 300, "2026-10-22", "entregado", "ACTIVO"),         // vencido, sin presentar
  ch("90017004", 200, "2026-10-24", "pendiente", null),             // vencido, sin estado del banco
  ch("90017005", 4000, "2026-10-28"),                               // dentro de 7 días
  ch("90017006", 9000, "2026-11-20"),                               // lejos
  ch("90017007", 700, "2026-10-12", "cobrado", "PAGADO"),           // ya cobrado: no cuenta
  ch("90017008", 800, "2026-10-12", "anulado", "ANULADO"),          // anulado: no cuenta
  ch("90017009", 50, "2026-10-12", "entregado", "ACTIVO", { moneda: "USD" }),         // dólares: no cuenta
  ch("90017010", 60, "2026-10-12", "en_cartera", "ACTIVO", { direccion: "recibido" }), // recibido: no cuenta
  ch("00090000172", 91234, "2026-10-12", "entregado", "ACTIVO"),    // INDU (con ceros adelante)
  ch("90000173", 441927.91, "2026-11-21", "entregado", "ACTIVO_PENDIENTE"), // INDU
], HOY);
assert.equal(c.hoy.total, 2000); assert.equal(c.hoy.cantidad, 4);
assert.deepEqual(c.hoy.enTramite, { cantidad: 2, total: 1500 });
assert.deepEqual(c.hoy.sinPresentar, { cantidad: 2, total: 500 });
assert.equal(c.proximos7.total, 6000); assert.equal(c.proximos7.cantidad, 5);
assert.equal(c.indu.cheques.length, 2); assert.equal(c.indu.total, 533161.91);
assert.deepEqual(c.indu.cheques.map((x) => x.numero), ["90000172", "90000173"]);

// Sobra o falta
assert.equal(sobraOFalta(16736633.36, 10802913.97), 5933719.39);
assert.equal(sobraOFalta(100, 250), -150);
assert.equal(sobraOFalta(null, 250), null);
assert.equal(sobraOFalta(undefined, 250), null);

// Antigüedad del saldo
assert.equal(diasDesde("2026-10-23", HOY), 2);
assert.equal(diasDesde(null, HOY), null);

// Sin cheques
const v = coberturaCheques([], HOY);
assert.equal(v.hoy.total, 0); assert.equal(v.indu.cheques.length, 0);

// Cheques que el banco ya debitó (línea en el extracto) o que figuran PAGADO: no se cuentan otra vez (25/10/2026)
const deb = numerosDebitados([
  { descripcion: "PAGO CHEQUE 48HS CAP.FED. N 90017348 #005", tipo: "debito" },
  { descripcion: "CJE. INTERNO N 90017243 #016", tipo: "debito" },
  { descripcion: "PAGO CHEQUE 24HS 90017218 #016", tipo: "debito" },          // formato viejo, sin " N "
  { descripcion: "CH/CLEAR.48  000709521272275 N 90017095", tipo: "debito" }, // sin código
  { descripcion: "DEPOS.CHQ.48 CFU. E09191840 #082", tipo: "credito" },       // depósito: no
  { descripcion: "TRANSFERENCIA 30716314797 #319", tipo: "debito" },          // no es cheque
  { descripcion: "DEVUELTO CAP F N 74 #019", tipo: "debito" },                // rechazo: no es un pago
]);
assert.deepEqual([...deb].sort(), ["90017095", "90017218", "90017243", "90017348"]);
const d = coberturaCheques([
  ch("90017348", 150000, "2026-10-21", "entregado", "PRESENTADO"),  // debitado según el extracto
  ch("90017243", 1000000, "2026-10-21", "entregado", "DEPOSITADO"), // debitado según el extracto
  ch("90017400", 70000, "2026-10-21", "entregado", "PAGADO"),       // PAGADO según el banco
  ch("90017337", 590967.49, "2026-10-21", "entregado", "ACTIVO"),   // sigue pendiente
], HOY, deb);
assert.equal(d.hoy.cantidad, 1); assert.equal(d.hoy.total, 590967.49);
assert.deepEqual(d.yaDebitados, { cantidad: 3, total: 1220000 });

console.log("test-cobertura-cheques OK");
