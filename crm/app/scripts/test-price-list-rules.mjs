import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import vm from "node:vm";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const appDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(appDir, "src/lib/price-list-rules.ts"), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const context = { exports: {}, Intl, Date };
vm.createContext(context);
vm.runInContext(js, context);
const { calculateNetPrice, parseQuantityRange } = context.exports;

assert.deepEqual({ ...parseQuantityRange("10-49 un") }, { min: 10, max: 49 });
assert.deepEqual({ ...parseQuantityRange("50+") }, { min: 50, max: Infinity });
assert.equal(parseQuantityRange("Color rojo"), null, "una variante común no debe interpretarse como cantidad");

const rules = [
  { id: "global", lista_id: "l", tipo: "global", nombre: "General", descuento: 5, prioridad: 1, activa: true },
  { id: "cat", lista_id: "l", tipo: "categoria", nombre: "Válvulas", descuento: 10, categoria: "Válvulas", prioridad: 2, activa: true },
  { id: "qty", lista_id: "l", tipo: "cantidad", nombre: "Mayorista", descuento: 20, cantidad_desde: 50, cantidad_hasta: null, prioridad: 2, activa: true },
  { id: "future", lista_id: "l", tipo: "global", nombre: "Futuro", descuento: 99, prioridad: 99, activa: true, vigencia_desde: "2027-01-01" },
];
const item = { precio: 120, precio_neto: 100, descuento: 16.67, categoria: "Válvulas", variante: "50+" };
let result = calculateNetPrice(item, rules, null, "2026-09-25");
assert.equal(result.baseNet, 100, "el precio neto manual debe conservarse como base");
assert.equal(result.netPrice, 80, "la regla de cantidad debe ganar el empate por especificidad");
assert.equal(result.rule.id, "qty");

result = calculateNetPrice(item, rules, 20, "2026-09-25");
assert.equal(result.netPrice, 90, "con cantidad explícita debe aplicar la regla de categoría");
assert.equal(result.rule.id, "cat");

result = calculateNetPrice({ precio: 200, descuento: 10, categoria: "Otros" }, rules, 1, "2026-09-25");
assert.equal(result.baseNet, 180, "sin neto explícito debe respetar el descuento manual");
assert.equal(result.netPrice, 171, "la regla global se aplica sobre la base manual");

const migration = fs.readFileSync(path.join(appDir, "supabase/migrations/20260925210000_lista_precios_reglas.sql"), "utf8");
for (const token of ["sociedad_id uuid not null", "vigencia_desde date", "prioridad integer", "enable row level security", "validar_regla_lista_sociedad", "p.role::text in ('super_admin', 'admin', 'administrativo')"]) {
  assert.ok(migration.includes(token), `falta protección de esquema: ${token}`);
}
const ui = fs.readFileSync(path.join(appDir, "src/app/(crm)/proveedores/page.tsx"), "utf8");
assert.ok(ui.includes("Agregar regla") && ui.includes("Guardar regla"), "la UI debe permitir cargar reglas");
assert.ok(ui.includes("lista_precios_reglas(*)"), "la UI debe leer y mostrar reglas");
const budgets = fs.readFileSync(path.join(appDir, "src/app/(crm)/presupuestos/page.tsx"), "utf8");
assert.ok(budgets.includes("calculateNetPrice") && budgets.includes("lista_precios_reglas"), "presupuestos debe consumir las reglas activas");
assert.ok(budgets.includes('.eq("sociedad_id" as any, sociedadActiva?.id || "")'), "la búsqueda debe mantener alcance por sociedad");

console.log("OK: reglas de costo deterministas, vigentes y aisladas por sociedad.");
