const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const source = fs.readFileSync("src/lib/decimal-input.ts", "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const context = { exports: {} };
vm.runInNewContext(output, context);
const { parseDecimalInput, toDecimalInput } = context.exports;

assert.equal(parseDecimalInput("834.77"), 834.77);
assert.equal(parseDecimalInput("834,77"), 834.77);
assert.equal(parseDecimalInput("1530"), 1530);
assert.equal(parseDecimalInput(""), 0);
// Separadores de miles (formato argentino e inglés)
assert.equal(parseDecimalInput("1.234,56"), 1234.56);
assert.equal(parseDecimalInput("1,234.56"), 1234.56);
assert.equal(parseDecimalInput("1.241.525,27"), 1241525.27);
assert.equal(parseDecimalInput("1241525,27"), 1241525.27);
assert.equal(parseDecimalInput("1.241.525"), 1241525);
assert.equal(parseDecimalInput("$ 1.000,50"), 1000.5);
assert.equal(parseDecimalInput("1.530"), 1530);
assert.equal(parseDecimalInput("1,530"), 1.53);
assert.equal(parseDecimalInput("0.125"), 0.125);
assert.equal(parseDecimalInput("1530.5"), 1530.5);
assert.ok(Number.isNaN(parseDecimalInput("12.34.5")));
assert.ok(Number.isNaN(parseDecimalInput("1.2,3,4")));
assert.ok(Number.isNaN(parseDecimalInput("abc")));
// Los valores que carga el sistema vuelven a leerse igual
for (const n of [980.125, 1530, 1437.524353, 834.77]) assert.equal(parseDecimalInput(toDecimalInput(n)), n);
assert.equal(Math.round((834.77 - parseDecimalInput("834.77")) * 100), 0);

const dialog = fs.readFileSync("src/components/fx-settlement-dialog.tsx", "utf8");
assert.match(dialog, /const parseNum = parseDecimalInput/);
assert.doesNotMatch(dialog, /replace\(\/\\\.\/g,\s*""\)/);
assert.match(dialog, /Supera el saldo por/);
assert.match(dialog, /TC implícito del pago/);
assert.match(dialog, /Usar TC de la factura/);
assert.match(dialog, /Completar con el saldo total de la factura/);
assert.doesNotMatch(dialog, /type="number"/);

console.log("OK: decimales y miles en liquidación USD, exceso de saldo visible y TC implícito.");
