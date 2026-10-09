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
const { parseDecimalInput } = context.exports;

assert.equal(parseDecimalInput("834.77"), 834.77);
assert.equal(parseDecimalInput("834,77"), 834.77);
assert.equal(parseDecimalInput("1530"), 1530);
assert.equal(parseDecimalInput(""), 0);
assert.ok(Number.isNaN(parseDecimalInput("1.234,56")));
assert.equal(Math.round((834.77 - parseDecimalInput("834.77")) * 100), 0);

const dialog = fs.readFileSync("src/components/fx-settlement-dialog.tsx", "utf8");
assert.match(dialog, /const parseNum = parseDecimalInput/);
assert.doesNotMatch(dialog, /replace\(\/\\\.\/g,\s*""\)/);
assert.match(dialog, /Supera el saldo por/);

console.log("OK: decimales de liquidación USD conservados y exceso de saldo visible.");
