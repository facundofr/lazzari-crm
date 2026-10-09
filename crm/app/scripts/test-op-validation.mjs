// Ejecuta únicamente los guards reales de handleCreateOP, antes de toda mutación.
import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
import ts from "typescript";

const file = fs.readFileSync(new URL("../src/app/(crm)/finanzas/page.tsx", import.meta.url), "utf8");
const proveedoresFile = fs.readFileSync(new URL("../src/app/(crm)/proveedores/page.tsx", import.meta.url), "utf8");
const fiscalConditionFile = fs.readFileSync(new URL("../src/lib/fiscal-condition.ts", import.meta.url), "utf8");
const paymentMoneyFile = fs.readFileSync(new URL("../src/lib/payment-money.ts", import.meta.url), "utf8");
const purchaseReconciliationFile = fs.readFileSync(new URL("../src/lib/purchase-invoice-reconciliation.ts", import.meta.url), "utf8");
const fiscalConditionJs = ts.transpileModule(fiscalConditionFile, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const fiscalModule = { exports: {} };
vm.runInNewContext(fiscalConditionJs, { module: fiscalModule, exports: fiscalModule.exports });
const { canonicalCondicionIva, isKnownCondicionIva } = fiscalModule.exports;
const paymentMoneyJs = ts.transpileModule(paymentMoneyFile, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const paymentMoneyModule = { exports: {} };
vm.runInNewContext(paymentMoneyJs, { module: paymentMoneyModule, exports: paymentMoneyModule.exports, Number, Math });
const { roundPaymentMoney, sumPaymentMoney } = paymentMoneyModule.exports;
const purchaseReconciliationJs = ts.transpileModule(purchaseReconciliationFile, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const purchaseReconciliationModule = { exports: {} };
vm.runInNewContext(purchaseReconciliationJs, { module: purchaseReconciliationModule, exports: purchaseReconciliationModule.exports, Number, Math, Map, Set });
const { canonicalPurchaseInvoiceNumber } = purchaseReconciliationModule.exports;
assert.equal(canonicalCondicionIva("Monotributo"), "Monotributo");
assert.equal(canonicalCondicionIva("Monotributista"), "Monotributo");
assert.equal(canonicalCondicionIva("Consumidor Final"), "CF");
assert.equal((file.match(/!isKnownCondicionIva\(opProvCondicion\)/g) || []).length, 2, "OP y pago directo deben compartir la validación fiscal");
assert.match(proveedoresFile, /<option value="Monotributo">Monotributo<\/option>/);
assert.match(proveedoresFile, /<option value="CF">Consumidor Final<\/option>/);
assert.doesNotMatch(proveedoresFile, /<option value="Monotributista">/);
const ast = ts.createSourceFile("finanzas.tsx", file, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let handler;
const visit = node => {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "handleCreateOP") handler = node;
  ts.forEachChild(node, visit);
};
visit(ast);
assert(handler?.body, "handleCreateOP debe existir");
const startSaving = handler.body.statements.findIndex(statement =>
  ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression)
  && ts.isIdentifier(statement.expression.expression) && statement.expression.expression.text === "setOpSaving");
assert(startSaving >= 0, "No se encontró el límite seguro antes de escribir datos");
const guards = handler.body.statements.slice(0, startSaving).map(statement => statement.getText(ast)).join("\n");
const js = ts.transpileModule(`async function validate() { ${guards}\n accepted = true; }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const defaults = () => ({
  sociedadActiva: { id: "sociedad" },
  opForm: { proveedor_id: "proveedor", moneda: "ARS", usar_monto_manual: false },
  opFCPendientes: [{ id: "fc-1", numero: "00001-00000123", tipo_comprobante: "FC A", selected: true, moneda: "ARS", monto_a_pagar: 100, saldo_pendiente: 100 }],
  opDatosError: "", opFCLoading: false, opCondicionLoading: false, opProvCondicion: "RI", opParsingCount: 0,
  opMontoBruto: 100, opRetencionGanancias: 10, opBaseSinIVA: 82.64, opNetoAPagar: 90,
  proveedoresOptions: [{ id: "proveedor", razon_social: "PROVEEDOR TEST", cuit: "30-12345678-9" }],
  opMedios: [{ moneda: "ARS", monto: 90 }],
});
async function check(name, overrides, valid, errorPattern, confirmPattern) {
  const { confirmResult = true, ...contextOverrides } = overrides;
  const confirmations = [];
  const context = { ...defaults(), ...contextOverrides, accepted: false, error: "" };
  context.isKnownCondicionIva = isKnownCondicionIva;
  context.roundPaymentMoney = roundPaymentMoney;
  context.sumPaymentMoney = sumPaymentMoney;
  context.canonicalPurchaseInvoiceNumber = canonicalPurchaseInvoiceNumber;
  context.setOpError = error => { context.error = error; };
  context.confirm = message => {
    confirmations.push(message);
    return confirmResult;
  };
  vm.createContext(context);
  vm.runInContext(js, context);
  await context.validate();
  assert.equal(context.accepted, valid, `${name}: ${context.error}`);
  if (errorPattern) assert.match(context.error, errorPattern);
  if (confirmPattern) {
    assert.match(confirmations.join("\n"), confirmPattern);
    assert.equal(confirmations.length, 1, `${name}: debe pedir una sola confirmación`);
  }
  console.log(`OK ${name}`);
}
await check("medios claramente menores al neto", { opMedios: [{ moneda: "ARS", monto: 88 }] }, false, /neto/);
await check("sobrepago cancelado por el operador", {
  opFCPendientes: [{ id: "fc-1", selected: true, moneda: "ARS", monto_a_pagar: 10, saldo_pendiente: 10 }],
  opMontoBruto: 10,
  opRetencionGanancias: 0,
  opBaseSinIVA: 10,
  opNetoAPagar: 10,
  opMedios: [{ moneda: "ARS", monto: 11 }],
  confirmResult: false,
}, false, undefined, /excedente qued.*favor/i);
await check("sobrepago confirmado permite crear la OP", {
  opFCPendientes: [{ id: "fc-1", selected: true, moneda: "ARS", monto_a_pagar: 10, saldo_pendiente: 10 }],
  opMontoBruto: 10,
  opRetencionGanancias: 0,
  opBaseSinIVA: 10,
  opNetoAPagar: 10,
  opMedios: [{ moneda: "ARS", monto: 11 }],
}, true, undefined, /excedente qued.*favor/i);
await check("medio negativo aun con suma correcta", { opMedios: [{ moneda: "ARS", monto: -10 }, { moneda: "ARS", monto: 100 }] }, false, /negativos/);
await check("facturas en monedas distintas", { opFCPendientes: [
  { id: "fc-1", selected: true, moneda: "ARS", monto_a_pagar: 50, saldo_pendiente: 50 },
  { id: "fc-2", selected: true, moneda: "USD", monto_a_pagar: 50, saldo_pendiente: 50 },
] }, false, /moneda/);
await check("medio en moneda distinta", { opMedios: [{ moneda: "USD", monto: 90 }] }, false, /moneda/);
await check("saldos históricos no verificados", { opDatosError: "Falló el historial" }, false, /historial/);
await check("facturas cargando", { opFCLoading: true }, false, /carga/);
await check("Monotributo canónico permite crear la OP", { opProvCondicion: "Monotributo" }, true);
await check("condición fiscal desconocida se bloquea", { opProvCondicion: "Desconocida" }, false, /no está reconocida/);
await check("monto superior al saldo", { opFCPendientes: [{ id: "fc-1", selected: true, moneda: "ARS", monto_a_pagar: 100, saldo_pendiente: 50 }] }, false, /saldo/);
await check("dos registros distintos con igual número e importe", {
  opFCPendientes: [
    { id: "fc-1", numero: "1/123", tipo_comprobante: "FC A", selected: true, moneda: "ARS", monto_a_pagar: 50, saldo_pendiente: 50 },
    { id: "fc-2", numero: "00001-00000123", tipo_comprobante: "FC A", selected: true, moneda: "ARS", monto_a_pagar: 50, saldo_pendiente: 50 },
  ],
}, true);
await check("mismo registro seleccionado dos veces", {
  opFCPendientes: [
    { id: "fc-1", numero: "1/123", tipo_comprobante: "FC A", selected: true, moneda: "ARS", monto_a_pagar: 50, saldo_pendiente: 50 },
    { id: "fc-1", numero: "1/123", tipo_comprobante: "FC A", selected: true, moneda: "ARS", monto_a_pagar: 50, saldo_pendiente: 50 },
  ],
}, false, /seleccionada dos veces/);
await check("e-cheq duplicado en dos medios", { opMedios: [{ moneda: "ARS", monto: 45, echeq_id: "same" }, { moneda: "ARS", monto: 45, echeq_id: "same" }] }, false, /mismo e-cheq/);
await check("e-cheq propio emitido manualmente", { opMedios: [{ tipo: "echeq", origen_cheque: "propio", moneda: "ARS", monto: 90 }] }, true);
await check("e-cheq de tercero sin cartera", { opMedios: [{ tipo: "echeq", origen_cheque: "cartera", moneda: "ARS", monto: 90 }] }, false, /cartera/);
await check("e-cheq de tercero seleccionado de cartera", { opMedios: [{ tipo: "echeq", origen_cheque: "cartera", echeq_id: "received", moneda: "ARS", monto: 90 }] }, true);
await check("cheque tercero manual", { opMedios: [{ tipo: "cheque", origen_cheque: "cartera", moneda: "ARS", monto: 90 }] }, false, /cartera/);
await check("e-cheq bloquea CUIT fiscal inválido", {
  proveedoresOptions: [{ id: "proveedor", razon_social: "PROVEEDOR TEST", cuit: "123" }],
  opMedios: [{ tipo: "echeq", origen_cheque: "propio", moneda: "ARS", monto: 90 }],
}, false, /CUIT válido/);
await check("OP válida permite iniciar guardado", {}, true);
console.log("20 pruebas de validación OP aprobadas; no se ejecutaron escrituras ni llamadas de red.");
