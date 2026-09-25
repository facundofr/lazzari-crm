import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import vm from "node:vm";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const appDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = relativePath => fs.readFileSync(path.join(appDir, relativePath), "utf8");

function findFunction(source, filename, name) {
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(found, `No se encontró ${name}`);
  return found;
}

const finanzas = read("src/app/(crm)/finanzas/page.tsx");
const context = {};
vm.createContext(context);
for (const name of ["sumarDiasISO", "calcularFechaPactada"]) {
  const compiled = ts.transpileModule(findFunction(finanzas, "finanzas.tsx", name), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInContext(compiled, context);
}

assert.equal(context.calcularFechaPactada(["2026-09-20", "2026-09-10"], 30), "2026-10-10", "debe usar la factura seleccionada más antigua");
assert.equal(context.calcularFechaPactada(["2026-09-10"], 0), "2026-09-10", "cero días representa pago inmediato");
assert.equal(context.calcularFechaPactada([], 30), null, "sin factura no debe inventar una fecha");
assert.equal(context.calcularFechaPactada(["2026-02-30", "2026-03-01"], 15), "2026-03-16", "debe ignorar fechas calendarias inválidas");
assert.match(finanzas, /value=\{opForm\.fecha\} onChange=\{\(e\) => setOpForm\(\{ \.\.\.opForm, fecha: e\.target\.value \}\)\}/, "la fecha real de pago debe seguir siendo editable e independiente");
assert.match(finanzas, /dias_cuenta_corriente/, "la OP debe consultar los días pactados reales del proveedor");
assert.match(finanzas, /seleccioná una factura para calcular la fecha sugerida/, "la UI debe explicar cuándo puede calcular la sugerencia");

const proveedores = read("src/app/(crm)/proveedores/page.tsx");
const migration = read("supabase/migrations/20260925160000_proveedores_cuit_titular_cuenta.sql");
assert.match(migration, /ADD COLUMN IF NOT EXISTS cuit_titular_cuenta text/, "la migración debe crear un campo separado");
assert.match(migration, /no reemplaza el CUIT fiscal/, "la migración debe documentar la separación respecto del CUIT fiscal");
assert.match(proveedores, /cuitTitularCuenta: \(row\.cuit_titular_cuenta as string\)/, "el mapper debe leer el CUIT/CUIL bancario");
assert.match(proveedores, /value=\{form\.cuit_titular_cuenta\}/, "el formulario debe permitir editar el CUIT/CUIL bancario");
assert.match(proveedores, /selectedProv\.cuitTitularCuenta \|\| "—"/, "el detalle debe visualizar el CUIT/CUIL bancario");

console.log("OK: CUIT/CUIL bancario separado y condición de pago informativa en OP.");
