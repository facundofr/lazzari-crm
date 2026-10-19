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
assert.deepEqual(bna, { conCuotas: true, capital: 1200, pagado: 750, falta: 650, cuotasPagadas: 2, cuotasTotal: 4, vencidas: 1, proxima: { fecha: "2026-10-09", monto: 330 } });

// Sin cuotas fijas (familia): pagos anotados, falta = capital − pagado
const familia = resumenPrestamo({ capital_total: 25000 }, [{ numero: 1, fecha_pago: "2026-10-01", total: 1000, estado: "pagada" }], hoy);
assert.deepEqual([familia.conCuotas, familia.pagado, familia.falta, familia.proxima], [false, 1000, 24000, null]);
assert.equal(resumenPrestamo({ capital_total: 8500 }, [], hoy).falta, 8500);

assert.equal(diasDesde("2026-10-16", hoy), 3);
assert.equal(diasDesde(null, hoy), null);

console.log("test-bancos-lazza OK");
