import assert from "node:assert/strict";
import { diasDesde, resumenPrestamo } from "../src/lib/bancos-lazza";

const hoy = "2026-10-19";

// Con cuotas (BNA): 2 pagadas, 1 vencida, 1 por venir
const bna = resumenPrestamo({ capital_total: 1200 }, [
  { numero: 1, fecha_pago: "2026-08-10", total: 400, estado: "pagada" },
  { numero: 2, fecha_pago: "2026-09-10", total: 350, estado: "pagada" },
  { numero: 3, fecha_pago: "2026-10-09", total: 330, estado: "pendiente" },
  { numero: 4, fecha_pago: "2026-11-10", total: 320, estado: "pendiente" },
], hoy);
assert.deepEqual(bna, { conCuotas: true, capital: 1200, pagado: 750, falta: 650, capitalFalta: 0, cuotasPagadas: 2, cuotasTotal: 4, vencidas: 1, proxima: { fecha: "2026-10-09", monto: 330 } });

// Sin cuotas fijas (familia): pagos anotados, falta = capital − pagado
const familia = resumenPrestamo({ capital_total: 25000 }, [{ numero: 1, fecha_pago: "2026-10-01", total: 1000, estado: "pagada" }], hoy);
assert.deepEqual([familia.conCuotas, familia.pagado, familia.falta, familia.proxima], [false, 1000, 24000, null]);
assert.equal(resumenPrestamo({ capital_total: 8500 }, [], hoy).falta, 8500);

// BNA con capital por cuota: capital que falta; con todo pagado sigue "con cuotas" y falta 0
const bna2 = [
  { numero: 1, fecha_pago: "2026-09-10", total: 357, estado: "pagada", capital: 278 },
  { numero: 2, fecha_pago: "2026-11-10", total: 335, estado: "pendiente", capital: 278 },
  { numero: 3, fecha_pago: "2026-12-10", total: 331, estado: "a_confirmar", capital: 278 },
];
const r2b = resumenPrestamo({ capital_total: 834 }, bna2, hoy);
assert.deepEqual([r2b.capitalFalta, r2b.falta, r2b.vencidas], [556, 666, 0]);
const todo = resumenPrestamo({ capital_total: 834 }, bna2.map((c) => ({ ...c, estado: "pagada" })), hoy);
assert.deepEqual([todo.conCuotas, todo.falta, todo.proxima], [true, 0, null]);

assert.equal(diasDesde("2026-10-16", hoy), 3);
assert.equal(diasDesde(null, hoy), null);

console.log("test-bancos-lazza OK");
