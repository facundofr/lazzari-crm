import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
import ts from "typescript";
const source = fs.readFileSync(new URL("../src/app/(crm)/finanzas/page.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("finanzas.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let handler;
function visit(node) { if (ts.isFunctionDeclaration(node) && node.name?.text === "handleCreateOP") handler = node; ts.forEachChild(node, visit); }
visit(ast);
const tryStatement = handler.body.statements.find(ts.isTryStatement);
const validation = tryStatement.tryBlock.statements.find(statement => ts.isIfStatement(statement) && statement.expression.getText(ast) === "selectedEcheqIds.length");
assert(validation, "Debe validar cartera antes de crear la OP");
const js = ts.transpileModule(`async function validate() { ${validation.getText(ast)} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
async function run(name, data, expectedError, queryError = null) {
  const context = {
    selectedEcheqIds: ["cheque"], sociedadActiva: { id: "soc" }, opMedios: [{ echeq_id: "cheque", monto: 90, moneda: "ARS" }],
    supabase: { from() { return { select() { return this; }, eq() { return this; }, async in() { return { data, error: queryError }; } }; } },
  };
  vm.createContext(context); vm.runInContext(js, context);
  if (expectedError) await assert.rejects(context.validate(), expectedError); else await context.validate();
  console.log(`OK ${name}`);
}
const available = { id: "cheque", estado: "en_cartera", monto: 90, moneda: "ARS" };
await run("e-cheq disponible y coincidente", [available]);
await run("e-cheq ya endosado bloquea", [{ ...available, estado: "endosado" }], /no está disponible/);
await run("e-cheq de moneda distinta bloquea", [{ ...available, moneda: "USD" }], /no está disponible/);
await run("e-cheq no admite fraccionar su importe", [{ ...available, monto: 180 }], /no está disponible/);
await run("e-cheq inaccesible bloquea", [], /no está disponible/);
await run("error consultando cartera bloquea", null, /verificar la cartera/, { message: "network" });
console.log("6 pruebas de cartera e-cheq aprobadas; sin escrituras reales.");
