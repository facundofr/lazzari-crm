// npx tsx scripts/test-gastos-lazza.ts
import assert from "node:assert/strict";
import { nombreGrupo, armarFilasGastos, filtrarGastos, fijosSinCargar, grupoDe, grupoDeCategoria, totalesPorGrupo, venceEnMes, type FijoRow, type GastoRow } from "../src/lib/gastos-lazza";

assert.equal(grupoDeCategoria("Sueldos"), "Personal");
assert.equal(grupoDeCategoria("Débitos automáticos"), "Local y servicios");
assert.equal(grupoDeCategoria("debitos automaticos"), "Local y servicios");
assert.equal(grupoDeCategoria("Bancarios"), "Bancos y financieros");
assert.equal(grupoDeCategoria("Importaciones"), "Operativos");
assert.equal(grupoDeCategoria("algo nuevo"), "Operativos");
assert.equal(grupoDe({ grupo: "Impuestos", categoria: "Sueldos" }), "Impuestos"); // el grupo elegido gana
assert.equal(grupoDe({ grupo: "cualquiera", categoria: "Sueldos" }), "Personal");

const fijos: FijoRow[] = [
  { id: "luz", descripcion: "Luz", categoria: "Débitos automáticos", monto: 100, moneda: "ARS", activo: true, dia_vencimiento: 7, medio_pago: "debito_automatico" },
  { id: "sueldo", descripcion: "Sueldo", categoria: "Sueldos", monto: 1000, moneda: "ARS", activo: true, dia_vencimiento: 31 },
  { id: "alq", descripcion: "Alquiler", categoria: "Alquiler", grupo: "Local y servicios", monto: 800, moneda: "USD", activo: true, dia_vencimiento: null },
  { id: "viejo", descripcion: "Baja", categoria: "Servicios", monto: 5, moneda: "ARS", activo: false, dia_vencimiento: 1 },
];
const gastos: GastoRow[] = [
  { id: "g1", fecha: "2026-10-07", descripcion: "Luz oct", categoria: "Débitos automáticos", monto: "263928.17", moneda: "ARS", medio_pago: "transferencia", tipo_recurrencia: "mensual", gasto_fijo_id: "luz", notas: "[débito automático cargado solo]" },
  { id: "g2", fecha: "2026-10-16", descripcion: "VEP", categoria: "Impuestos", monto: 2520000, moneda: "ARS", medio_pago: "debito", tipo_recurrencia: "eventual", gasto_fijo_id: null },
  { id: "g3", fecha: "2026-10-01", descripcion: "Alquiler oct", categoria: "Alquiler", grupo: "Personales", monto: 800, moneda: "USD", medio_pago: "transferencia", tipo_recurrencia: "fijo", gasto_fijo_id: "alq" },
];
const filas = armarFilasGastos(gastos, fijos);
assert.deepEqual(filas.map((f) => f.id), ["g2", "g1", "g3"]);
const luz = filas.find((f) => f.id === "g1")!;
assert.equal(luz.medio, "debito_automatico"); assert.equal(luz.fijo, true); assert.equal(luz.cargadoSolo, true); assert.equal(luz.grupo, "Local y servicios");
assert.equal(filas.find((f) => f.id === "g2")!.fijo, false);
assert.equal(filas.find((f) => f.id === "g3")!.grupo, "Personales"); // se cambió de grupo a mano

assert.deepEqual(filtrarGastos(filas, { soloDebito: true }).map((f) => f.id), ["g1"]);
assert.deepEqual(filtrarGastos(filas, { tipo: "eventual" }).map((f) => f.id), ["g2"]);
assert.deepEqual(filtrarGastos(filas, { grupo: "Impuestos" }).map((f) => f.id), ["g2"]);
assert.deepEqual(filtrarGastos(filas, { texto: "debito automatico" }).map((f) => f.id), ["g1"]);

const t = totalesPorGrupo(filas);
assert.equal(t.length, 7);
assert.deepEqual(t.find((x) => x.grupo === "Impuestos"), { grupo: "Impuestos", n: 1, ARS: 2520000, USD: 0 });
assert.deepEqual(t.find((x) => x.grupo === "Personales"), { grupo: "Personales", n: 1, ARS: 0, USD: 800 });

assert.equal(venceEnMes(31, "2026-11"), "2026-11-30");
assert.equal(venceEnMes(7, "2026-10"), "2026-10-07");
assert.equal(venceEnMes(null, "2026-10"), null);

// Octubre: la luz y el alquiler ya están; falta el sueldo; el inactivo no aparece.
assert.deepEqual(fijosSinCargar(fijos, gastos, "2026-10").map((f) => [f.id, f.vence, f.grupoFinal]), [["sueldo", "2026-10-31", "Personal"]]);
// Noviembre: faltan los 3 activos (el alquiler sin día, al final).
assert.deepEqual(fijosSinCargar(fijos, gastos, "2026-11").map((f) => f.id), ["luz", "sueldo", "alq"]);

// Nombres que se ven en pantalla (Augusto 23/10): el valor guardado no cambia.
assert.equal(nombreGrupo("Personal"), "Sueldos");
assert.equal(nombreGrupo("Personales"), "Augusto");
assert.equal(nombreGrupo("Impuestos"), "Impuestos");

console.log("test-gastos-lazza OK");
