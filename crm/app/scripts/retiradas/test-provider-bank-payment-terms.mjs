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
const cargarFactura = read("src/components/cargar-factura-oc.tsx");
assert.match(proveedores, /cuit_titular_cuenta: form\.cuit\.trim\(\)/, "guardar proveedor debe copiar automáticamente su CUIT fiscal al campo bancario histórico");
assert.doesNotMatch(proveedores, /value=\{form\.cuit_titular_cuenta\}/, "el formulario no debe pedir un segundo CUIT");
assert.match(proveedores, /CUIT para pagos y eCheq/, "el formulario debe explicar qué CUIT se utiliza");
assert.match(proveedores, /selectedProv\.cuit \|\| "—"/, "el detalle debe mostrar el CUIT fiscal del proveedor");
assert.match(cargarFactura, /cuit_titular_cuenta: nuevoProveedor\.cuit\.trim\(\)/, "crear proveedor desde Compras debe copiar el mismo CUIT");
assert.match(finanzas, /beneficiario_cuit: proveedorCuitPago \|\| null/, "cada medio de pago debe persistir el CUIT del proveedor como beneficiario");
assert.match(finanzas, /CUIT del proveedor \(cheque \/ eCheq\)/, "la OP debe mostrar el CUIT fiscal que se usará");
assert.match(finanzas, /proveedorCuitPago\.length !== 11/, "cheques y eCheq deben bloquear un CUIT fiscal inválido");

console.log("OK: pagos y eCheq usan siempre el CUIT fiscal del proveedor; no existe un segundo CUIT editable.");
