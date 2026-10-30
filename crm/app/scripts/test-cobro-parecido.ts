import assert from "node:assert/strict";
import { mismoPago, type PagoComparable } from "../src/lib/comprobante-medios";
import { movimientoParecido, rangoParecido, renglonesRepetidos } from "../src/lib/cobro-parecido";

// Renglones repetidos en un mismo cobro (D5: Truck Roque, efectivo 100.000 dos veces el mismo día)
const p = (x: Partial<PagoComparable>): PagoComparable => ({ tipo: "efectivo", monto: 100_000, fecha: "2026-09-10", ...x });
const roque = [p({}), p({ tipo: "transferencia" }), p({})];
assert.deepEqual(renglonesRepetidos(roque, mismoPago).map((g) => [g.renglon.tipo, g.veces]), [["efectivo", 2]], "efectivo dos veces");
assert.deepEqual(renglonesRepetidos([p({}), p({}), p({})], mismoPago).map((g) => g.veces), [3], "tres veces el mismo");
assert.equal(renglonesRepetidos([p({}), p({ monto: 100_001 })], mismoPago).length, 0, "otro importe");
assert.equal(renglonesRepetidos([p({}), p({ fecha: "2026-09-11" })], mismoPago).length, 0, "otro día");
assert.equal(renglonesRepetidos([p({ tipo: "echeq", numero: "123" }), p({ tipo: "echeq", numero: "124" })], mismoPago).length, 0, "dos cheques distintos del mismo importe");
assert.equal(renglonesRepetidos([p({ tipo: "echeq", numero: "123" }), p({ tipo: "echeq", numero: "000123" })], mismoPago).length, 1, "el mismo cheque dos veces");
assert.equal(renglonesRepetidos([p({ monto: 0 }), p({ monto: 0 })], mismoPago).length, 0, "renglones vacíos no cuentan");
assert.equal(renglonesRepetidos([], mismoPago).length, 0);

// Cobro suelto parecido: mismo importe ±$ 1 y a 5 días o menos
const m = (id: string, fecha: string, monto: number, moneda = "ARS") => ({ id, fecha, monto, moneda });
const cargados = [m("a", "2026-09-10", 33_000), m("b", "2026-09-20", 33_000), m("c", "2026-09-12", 33_000.8), m("d", "2026-09-11", 33_000, "USD")];
assert.equal(movimientoParecido({ fecha: "2026-09-12", monto: 33_000 }, cargados)?.id, "c", "el más cercano en fecha (±$ 1 vale)");
assert.equal(movimientoParecido({ fecha: "2026-09-15", monto: 33_000 }, [m("a", "2026-09-10", 33_000)])?.id, "a", "5 días justos");
assert.equal(movimientoParecido({ fecha: "2026-09-16", monto: 33_000 }, [m("a", "2026-09-10", 33_000)]), null, "6 días: no");
assert.equal(movimientoParecido({ fecha: "2026-09-10", monto: 33_002 }, [m("a", "2026-09-10", 33_000)]), null, "$ 2 de diferencia: no");
assert.equal(movimientoParecido({ fecha: "2026-09-11", monto: 33_000, moneda: "USD" }, cargados)?.id, "d", "solo la misma moneda");
assert.equal(movimientoParecido({ fecha: "2026-09-10", monto: 0 }, cargados), null, "sin importe no compara");
assert.equal(movimientoParecido({ fecha: "2026-09-10", monto: 33_000 }, [{ ...m("e", "2026-09-10T03:00:00.000Z", 0), monto: "33000.00" }])?.id, "e", "importe y fecha como vienen de la base");

// Rango para buscar en la base
assert.deepEqual(rangoParecido(["2026-10-30", "2026-10-28"]), { desde: "2026-10-23", hasta: "2026-11-04" });
assert.deepEqual(rangoParecido(["2026-03-02"]), { desde: "2026-02-25", hasta: "2026-03-07" }, "cruza el mes");
assert.equal(rangoParecido([]), null);
assert.equal(rangoParecido(["cualquier cosa"]), null);

console.log("test-cobro-parecido: OK");
