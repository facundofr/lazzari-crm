import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
import ts from "typescript";

const source = fs.readFileSync(new URL("../src/lib/nombre-fantasia.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
const exports = {};
vm.runInNewContext(compiled.outputText, { exports });
const { decidirNombreFantasia: decidir, aprenderNombreFantasiaDeFactura: aprender, cuitsCoinciden } = exports;

assert.deepEqual({ ...decidir(null, "Segutécnica", "SEGURIDAD TECNICA SA") }, { accion: "guardar", valor: "Segutécnica" });
assert.deepEqual({ ...decidir("", "  Segutécnica  ", "X SA") }, { accion: "guardar", valor: "Segutécnica" });
assert.equal(decidir(null, "", "X SA").accion, "nada");
assert.equal(decidir(null, null, "X SA").accion, "nada");
assert.equal(decidir(null, "Ombú S.A.", "OMBU SA").accion, "nada"); // igual a la razón social
assert.equal(decidir(null, "Ombú", ["OTRA SRL", "ombu"]).accion, "nada"); // igual a la razón social de la factura
assert.equal(decidir("SEGUTECNICA", "Segutécnica", "X SA").accion, "nada"); // ya lo tiene
assert.deepEqual({ ...decidir("Funcional", "Segutécnica", "X SA") }, { accion: "distinto", valor: "Segutécnica" });

assert.equal(cuitsCoinciden("30-71234567-8", "30712345678"), true);
assert.equal(cuitsCoinciden("", "30712345678"), false); // falta uno: no se aprende
assert.equal(cuitsCoinciden("30712345678", null), false);
assert.equal(cuitsCoinciden("30712345678", "20111111112"), false);

// Integración con una base simulada: solo actualiza nombre_fantasia y avisa.
function fakeDb(row, updateError = null, filasActualizadas = [{ id: "p1" }]) {
  const calls = [];
  const chain = (kind, payload) => {
    const c = {
      eq: () => c,
      or: (f) => { calls.push({ kind: "or", payload: f }); return c; },
      select: () => c,
      maybeSingle: async () => ({ data: row, error: null }),
      then: (res) => res(updateError ? { data: null, error: updateError } : { data: filasActualizadas, error: null }),
    };
    calls.push({ kind, payload });
    return c;
  };
  return { calls, from: () => ({ select: () => chain("select"), update: (p) => chain("update", p) }) };
}
const avisos = () => { const l = []; return { l, info: m => l.push(["info", m]), warning: m => l.push(["warning", m]) }; };

let db = fakeDb({ id: "p1", razon_social: "SEGURIDAD TECNICA SA", nombre_fantasia: null, cuit: "30-71234567-8" });
let a = avisos();
await aprender(db, { proveedorId: "p1", sociedadId: "s", deFactura: "Segutécnica", cuitFactura: "30712345678" }, a);
assert.deepEqual({ ...db.calls.find(c => c.kind === "update").payload }, { nombre_fantasia: "Segutécnica" });
assert.equal(db.calls.find(c => c.kind === "or").payload, "nombre_fantasia.is.null,nombre_fantasia.eq."); // solo si sigue vacío
assert.equal(a.l[0][0], "info");

// Otra carga lo guardó mientras tanto: el update condicional no toca filas → sin aviso.
db = fakeDb({ id: "p1", razon_social: "SEGURIDAD TECNICA SA", nombre_fantasia: null, cuit: "30712345678" }, null, []);
a = avisos();
await aprender(db, { proveedorId: "p1", sociedadId: "s", deFactura: "Segutécnica", cuitFactura: "30712345678" }, a);
assert.equal(db.calls.some(c => c.kind === "update"), true);
assert.equal(a.l.length, 0);

// CUIT de la factura distinto o faltante: no aprende.
for (const cuitFactura of ["20111111112", "", null]) {
  db = fakeDb({ id: "p1", razon_social: "SEGURIDAD TECNICA SA", nombre_fantasia: null, cuit: "30712345678" });
  a = avisos();
  await aprender(db, { proveedorId: "p1", sociedadId: "s", deFactura: "Segutécnica", cuitFactura }, a);
  assert.equal(db.calls.some(c => c.kind === "update"), false);
  assert.equal(a.l.length, 0);
}
// Proveedor sin CUIT cargado: no aprende.
db = fakeDb({ id: "p1", razon_social: "SEGURIDAD TECNICA SA", nombre_fantasia: null, cuit: null });
a = avisos();
await aprender(db, { proveedorId: "p1", deFactura: "Segutécnica", cuitFactura: "30712345678" }, a);
assert.equal(db.calls.some(c => c.kind === "update"), false);

db = fakeDb({ id: "p1", razon_social: "SEGURIDAD TECNICA SA", nombre_fantasia: "Funcional", cuit: "30712345678" });
a = avisos();
await aprender(db, { proveedorId: "p1", sociedadId: "s", deFactura: "Segutécnica", cuitFactura: "30712345678" }, a);
assert.equal(db.calls.some(c => c.kind === "update"), false);
assert.equal(a.l[0][0], "warning");
assert.match(a.l[0][1], /No lo cambié/);

db = fakeDb({ id: "p1", razon_social: "X", nombre_fantasia: null, cuit: "30712345678" }, { message: "rls" });
a = avisos();
await aprender(db, { proveedorId: "p1", deFactura: "Y", cuitFactura: "30712345678" }, a);
assert.equal(a.l[0][0], "warning");

console.log("PASS: 22 nombre de fantasía cases (guardar, distinto, igual a razón social, vacío, CUIT, update condicional, base simulada)");
