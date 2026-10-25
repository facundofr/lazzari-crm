// Prueba rápida: npx tsx scripts/test-cobertura-cheques.ts
import assert from "node:assert/strict";
import { coberturaCheques, sobraOFalta, diasDesde, type ChequeCobertura } from "../src/lib/cobertura-cheques";

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

console.log("test-cobertura-cheques OK");
