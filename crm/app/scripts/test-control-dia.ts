// Prueba rápida: npx tsx scripts/test-control-dia.ts
import assert from "node:assert/strict";
import { controlPorDia, limitarPorGuardadas, type LineaControl } from "../src/lib/control-dia";

const L = (fecha: string, ...importes: number[]): LineaControl[] => importes.map((importe) => ({ fecha, importe }));

// Todo igual: sin diferencias (el primer y el último día del archivo no se comparan)
let r = controlPorDia([...L("2026-10-01", -1), ...L("2026-10-02", -5, 10), ...L("2026-10-03", 7)], [...L("2026-10-01", -1), ...L("2026-10-02", 10, -5), ...L("2026-10-03", 7)]);
assert.deepEqual(r.diferencias, []); assert.equal(r.diasComparados, 1);

// Una línea guardada que el banco ya no trae
r = controlPorDia([...L("2026-10-01", -1), ...L("2026-10-02", -5), ...L("2026-10-03", 7), ...L("2026-10-04", 1)], [...L("2026-10-01", -1), ...L("2026-10-02", -5, -99), ...L("2026-10-03", 7), ...L("2026-10-04", 1)]);
assert.deepEqual(r.diferencias, [{ fecha: "2026-10-02", sobranEnBase: [-99], faltanEnBase: [] }]);

// El banco trae una línea que no está guardada, en un día anterior al último cargado: aviso
r = controlPorDia([...L("2026-10-01", -1), ...L("2026-10-02", -5, -8), ...L("2026-10-03", 7), ...L("2026-10-04", 1)], [...L("2026-10-01", -1), ...L("2026-10-02", -5), ...L("2026-10-03", 7), ...L("2026-10-04", 1)]);
assert.deepEqual(r.diferencias, [{ fecha: "2026-10-02", sobranEnBase: [], faltanEnBase: [-8] }]);

// Línea nueva en el último día cargado (o después): es lo normal, sin aviso
r = controlPorDia([...L("2026-10-01", -1), ...L("2026-10-02", -5, -8), ...L("2026-10-03", 4)], [...L("2026-10-01", -1), ...L("2026-10-02", -5)]);
assert.deepEqual(r.diferencias, []);
// El último día del archivo puede estar cortado: la base trae más, sin aviso
r = controlPorDia([...L("2026-10-01", -1), ...L("2026-10-02", -5)], [...L("2026-10-01", -1), ...L("2026-10-02", -5, -7)]);
assert.deepEqual(r.diferencias, []);

// Importes repetidos en el mismo día: se cuentan
r = controlPorDia([...L("2026-10-01", -1), ...L("2026-10-02", -5, -5), ...L("2026-10-03", 7), ...L("2026-10-04", 1)], [...L("2026-10-01", -1), ...L("2026-10-02", -5), ...L("2026-10-03", 7), ...L("2026-10-04", 1)]);
assert.deepEqual(r.diferencias, [{ fecha: "2026-10-02", sobranEnBase: [], faltanEnBase: [-5] }]);

// El primer día del archivo no se compara (puede venir cortado); días de la base fuera del rango del archivo tampoco
r = controlPorDia([...L("2026-10-05", -1), ...L("2026-10-06", 2), ...L("2026-10-07", 3)], [...L("2026-10-01", -9), ...L("2026-10-05", -1, -3), ...L("2026-10-06", 2), ...L("2026-10-07", 3)]);
assert.deepEqual(r.diferencias, []);
// Días del archivo anteriores a lo guardado: no hay con qué comparar, sin aviso
r = controlPorDia([...L("2026-08-01", 1), ...L("2026-08-02", 2, 3), ...L("2026-10-03", 5), ...L("2026-10-04", 6)], [...L("2026-10-03", 5), ...L("2026-10-04", 6)]);
assert.deepEqual(r.diferencias, []);

// Sin archivo / sin base
assert.deepEqual(controlPorDia([], L("2026-10-01", 1)), { diasComparados: 0, diferencias: [] });
r = controlPorDia([...L("2026-10-01", 1), ...L("2026-10-02", 2)], []);
assert.deepEqual(r.diferencias, []);

// limitarPorGuardadas: lo ya guardado (aunque cambie el saldo) no vuelve a entrar; lo realmente nuevo sí
const cand = (fecha: string, ...importes: number[]) => importes.map((importe, i) => ({ fecha, importe, saldo: i }));
const arch = [...L("2026-10-01", -5, -5, 7), ...L("2026-10-02", 3)];
assert.deepEqual(limitarPorGuardadas(cand("2026-10-01", -5, -5, 7), arch, [...L("2026-10-01", -5, -5, 7)]), []); // todo guardado
assert.equal(limitarPorGuardadas(cand("2026-10-01", -5, -5, 7), arch, [...L("2026-10-01", -5, 7)]).length, 1); // falta un -5
assert.equal(limitarPorGuardadas(cand("2026-10-02", 3), arch, []).length, 1); // nada guardado ese día
assert.equal(limitarPorGuardadas([...cand("2026-10-01", -5, -5, 7), ...cand("2026-10-02", 3)], arch, [...L("2026-10-01", -5, -5, 7)]).length, 1); // solo entra el del 02/10

console.log("test-control-dia OK");
