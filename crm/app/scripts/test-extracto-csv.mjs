import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the real parser without loading the React page or touching bank data.
const filename = 'src/app/(crm)/finanzas/page.tsx';
const source = readFileSync(filename, 'utf8');
const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const parser = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'parseExtractoCsv');
assert.ok(parser, 'Expected the production CSV parser');
const code = ts.transpileModule(parser.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const parse = vm.runInNewContext(`${code}\nparseExtractoCsv`);
let cases = 0;
function check(name, test) { test(); cases++; console.log(`OK ${name}`); }
check('negative signed amount is a debit', () => {
  const [row] = parse('Fecha;Importe\n11/09/2026;-1200,50');
  assert.equal(row.tipo, 'debito'); assert.equal(row.monto, 1200.5);
});
check('positive signed amount is a credit', () => {
  assert.equal(parse('Fecha;Importe\n2026-09-11;1200,50')[0].tipo, 'credito');
});
check('running balance is not a transaction amount', () => {
  assert.throws(() => parse('Fecha;Saldo\n11/09/2026;9000'), /columnas/);
});
check('debit and credit columns take precedence over balance', () => {
  const [row] = parse('Fecha;Débito;Crédito;Saldo\n11/09/2026;500;;9500');
  assert.equal(row.tipo, 'debito'); assert.equal(row.monto, 500);
});
check('invalid calendar date is rejected', () => {
  assert.throws(() => parse('Fecha;Importe\n31/02/2026;500'), /Fecha inválida/);
});
check('two sides in the same row are rejected', () => {
  assert.throws(() => parse('Fecha;Débito;Crédito\n11/09/2026;20;30'), /simultáneos/);
});
check('Argentine and international decimals', () => {
  assert.equal(parse('Fecha;Importe\n11/09/2026;1.234,56')[0].monto, 1234.56);
  assert.equal(parse('Fecha,Importe\n2026-09-11,"1,234.56"')[0].monto, 1234.56);
});
check('invalid amount is not silently dropped', () => {
  assert.throws(() => parse('Fecha;Importe\n11/09/2026;abc'), /Importe inválido/);
});
check('empty movements are rejected', () => {
  assert.throws(() => parse('Fecha;Importe\n11/09/2026;0'), /no contiene movimientos/);
});
check('explicit currency must match bank account', () => {
  assert.throws(() => parse('Fecha;Importe\n11/09/2026;USD 100', 'ARS'), /USD/);
  assert.equal(parse('Fecha;Importe\n11/09/2026;USD 100', 'USD')[0].monto, 100);
});
console.log(`${cases} pruebas de importación bancaria aprobadas.`);
