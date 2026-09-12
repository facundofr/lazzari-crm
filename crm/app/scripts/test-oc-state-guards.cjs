const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, '../src/app/(crm)/ordenes-compra/page.tsx'), 'utf8');
const ast = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const fragments = [];
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'handleUnassignPR') fragments.push(node.getText(ast));
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'handleAdvanceEstado') fragments.push(`var ${node.getText(ast)};`);
  ts.forEachChild(node, visit);
}
visit(ast);
assert.equal(fragments.length, 2);
function setup(result) {
  const state = { alerts: [], writes: [], filters: [], detailUpdates: [], listUpdates: 0, reloads: 0 };
  const query = {
    update(value) { state.writes.push(value); return this; },
    eq(column, value) { state.filters.push([column, value]); return this; },
    select() { return this; }, async maybeSingle() { return result; },
  };
  const context = {
    supabase: { from(table) { assert.equal(table, 'ordenes_compra'); return query; } },
    sociedadActiva: { id: 'society-one' },
    detailOC: { id: 'oc-one', presupuesto_origen_id: 'pr-one', estado: 'borrador' },
    alert(message) { state.alerts.push(message); },
    setDetailOC(value) { state.detailUpdates.push(value); },
    setOrdenes() { state.listUpdates++; },
    async fetchData() { state.reloads++; },
  };
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(fragments.join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context);
  return { context, state };
}
(async () => {
  for (const fn of ['handleUnassignPR', 'handleAdvanceEstado']) {
    for (const result of [{ data: null, error: null }, { data: null, error: { message: 'denied' } }]) {
      const { context, state } = setup(result);
      await context[fn](context.detailOC, 'pendiente');
      assert.equal(state.detailUpdates.length, 0, `${fn}: no debe inventar éxito`);
      assert.equal(state.listUpdates, 0);
      assert.equal(state.reloads, 0);
      assert.equal(state.alerts.length, 1);
      assert.ok(state.filters.some(([column, value]) => column === 'sociedad_id' && value === 'society-one'));
    }
    const { context, state } = setup({ data: { id: 'oc-one' }, error: null });
    await context[fn](context.detailOC, 'pendiente');
    assert.equal(state.detailUpdates.length, 1);
    assert.equal(state.alerts.length, 0);
    assert.ok(state.filters.some(([column, value]) => fn === 'handleAdvanceEstado' ? column === 'estado' && value === 'borrador' : column === 'presupuesto_origen_id' && value === 'pr-one'));
  }
  const { context, state } = setup({ data: { id: 'oc-one' }, error: null });
  context.sociedadActiva = null;
  await context.handleUnassignPR();
  await context.handleAdvanceEstado(context.detailOC, 'pendiente');
  assert.equal(state.writes.length, 0);
  console.log('OK: 8 casos de activación/desvinculación simulados; sin modificaciones reales.');
})().catch(error => { console.error(error); process.exitCode = 1; });
