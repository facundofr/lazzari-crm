// Prueba rápida: npx tsx scripts/test-fci-custodia.mjs
import assert from "node:assert/strict";
import { leerCustodiaBbva, cuotapartesAl, valuaciones, rendimientoPorMes } from "../src/lib/fci-custodia.ts";

const E = "FBA MONEY MARKET PESOS";
const filas = [
  [],
  ["Movimientos Cuenta Custodia: Cuenta Custodia: 91-565772/5"],
  ["Especie", "Descripción de Especie", "Fecha", "Tipo", "Cantidad (VN)", "Precio", "Monto Neto", "Moneda", "Estado", "Operación"],
  [E, E, "30/09/2026", "Rescate", "100", "110", "11.000,00", "$", "Realizada", "3"],
  [E, E, "15/09/2026", "Suscripción", "200", "105", "21.000,00", "$", "Realizada", "2"],
  [E, E, "27/08/2026", "Suscripción", "1.000", "100", "100.000,00", "$", "Realizada", "1"],
  [E, E, "28/08/2026", "Rescate", "5", "100,5", "502,50", "$", "Pendiente", "9"], // no realizada: se ignora
];
const ops = leerCustodiaBbva(filas);
assert.equal(ops.length, 3);
assert.equal(ops[0].fecha, "2026-08-27");
assert.equal(cuotapartesAl(ops, E, "2026-09-20"), 1200);
assert.deepEqual(valuaciones(ops, E).map((v) => v.valor), [100000, 126000, 121000]);
// Septiembre: 121.000 − 100.000 − 21.000 + 11.000 = 11.000. Octubre con el total del home banking (1.100 cp × 112).
const r = rendimientoPorMes(ops, E, [{ fecha: "2026-10-11", valor: 123200 }]);
assert.deepEqual(r.map((x) => [x.mes, x.desde, x.hasta, x.ganancia]), [["2026-09", "2026-08-27", "2026-09-30", 11000], ["2026-10", "2026-09-30", "2026-10-11", 2200]]);
console.log("fci-custodia OK");
